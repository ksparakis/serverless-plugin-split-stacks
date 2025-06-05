'use strict';

const _ = require('lodash');
const semver = require('semver');

const setDeploymentBucketEndpoint = require('./lib/deployment-bucket-endpoint');
const migrateExistingResources = require('./lib/migrate-existing-resources');
const migrateNewResources = require('./lib/migrate-new-resources');
const replaceReferences = require('./lib/replace-references');
const replaceConditions = require('./lib/replace-conditions');
const replaceOutputs = require('./lib/replace-outputs');
const mergeStackResources = require('./lib/merge-stack-resources');
const sequenceStacks = require('./lib/sequence-stacks');
const writeNestedStacks = require('./lib/write-nested-stacks');
const logSummary = require('./lib/log-summary');
const analyzeStacks = require('./lib/analyze-stacks');

const utils = require('./lib/utils');

const Custom = require('./lib/migration-strategy/custom');
const PerType = require('./lib/migration-strategy/per-type');
const PerFunction = require('./lib/migration-strategy/per-function');
const PerGroupFunction = require('./lib/migration-strategy/per-group-function');
const ByCustomGroup = require('./lib/migration-strategy/per-stack-name');

class ServerlessPluginSplitStacks {

  constructor(serverless, options) {
    if (!semver.satisfies(serverless.version, '>= 1.13')) {
      throw new Error('serverless-plugin-split-stacks requires serverless 1.13 or higher!');
    }

    this.serverless = serverless;
    this.options = options;
    this.provider = this.serverless.getProvider('aws');
    this.hooks = {
      'after:aws:package:finalize:mergeCustomProviderResources': this.split.bind(this),
      'aws:deploy:deploy:uploadArtifacts': this.upload.bind(this)
    };

    if (this.serverless.configSchemaHandler) {
      this.serverless.configSchemaHandler.defineFunctionProperties('aws', {
        properties: {
          stackName: {
            type: 'string',
            description: 'The name of the stack this function should be deployed to'
          }
        }
      });
    }

    Object.assign(this,
      utils,
      { setDeploymentBucketEndpoint },
      { migrateExistingResources },
      { migrateNewResources },
      { replaceReferences },
      { replaceConditions },
      { replaceOutputs },
      { mergeStackResources },
      { sequenceStacks },
      { writeNestedStacks },
      { logSummary },
      { analyzeStacks }
    );

    const custom = this.serverless.service.custom || {};

    this.config = Object.assign({
      plan: false,
      detailed: true,
      verbose: false,
      analyze: false,
      perCustomGroup: false
    }, custom.splitStacks || {});
    this.stacksMap = ServerlessPluginSplitStacks.stacksMap;

  }

  split() {
    this.rootTemplate = this.serverless.service.provider.compiledCloudFormationTemplate;
    this.resourcesById = Object.assign({}, this.rootTemplate.Resources);

    this.resourceMigrations = {};

    return Promise.resolve()
      .then(() => this.setDeploymentBucketEndpoint())
      .then(() => this.migrateExistingResources())
      .then(() => {
        // Store migration strategies for use in logSummary
        // Order matters - strategies are checked in sequence
        const custom = new Custom(this);
        const byCustomGroup = new ByCustomGroup(this);
        const perFunction = new PerFunction(this);
        const perType = new PerType(this);
        const perGroupFunction = new PerGroupFunction(this);

        // Custom strategy first, then byCustomGroup, then others
        this.migrationStrategies = [custom, byCustomGroup, perFunction, perType, perGroupFunction];
        return this.migrateNewResources();
      })
      .then(() => this.replaceReferences())
      .then(() => this.replaceOutputs())
      .then(() => this.replaceConditions())
      .then(() => this.mergeStackResources())
      .then(() => this.sequenceStacks())
      .then(() => this.writeNestedStacks())
      .then(() => this.logSummary())
      .then(() => this.analyzeStacks())
      .then(() => {
        if (this.config.plan) {
          this.log('[serverless-plugin-split-stacks-by-group]: Plan mode enabled - exiting without deployment');
          process.exit(0);
        }
      });
  }

  upload() {
    const deploymentBucketObject = this.serverless.service.provider.deploymentBucketObject;

    return this.provider.getServerlessDeploymentBucketName(this.options.stage, this.options.region)
      .then(deploymentBucket => {
        const files = this.getNestedStackFiles();

        return Promise.all(_.map(files, file => {
          const params = {
            Bucket: deploymentBucket,
            Key: file.key,
            Body: file.createReadStream(),
            ContentType: 'application/json',
          };

          if (deploymentBucketObject) {
            const encryptionParams = this.getEncryptionParams(deploymentBucketObject);
            Object.assign(params, encryptionParams);
          }

          return this.provider.request('S3', 'putObject', params);
        }));
      });
  }
}

module.exports = ServerlessPluginSplitStacks;
module.exports.stacksMap = {}; // legacy, will be removed
