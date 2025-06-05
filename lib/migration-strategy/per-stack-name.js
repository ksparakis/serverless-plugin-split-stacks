'use strict';

const BaseStrategy = require('./base-strategy');

module.exports = class ByCustomGroup extends BaseStrategy {

  constructor(plugin) {
    super(plugin);

    if (this.isStrategyActive()) {
      this.stackNameResourceMap = this.buildStackNameResourceMap(plugin.serverless);
      this.apiGatewayResourceMap = this.getApiGatewayResourceMap(plugin.serverless);
      this.lambdaNames = this.getAllNormalizedLambdaNames(plugin.serverless);
    }
  }

  buildStackNameResourceMap(serverless) {
    const stackNameResourceMap = new Map();

    Object.entries(serverless.service.functions).forEach(([funcName, funcConfig]) => {
      if (!funcConfig.stackName) {
        throw new Error(`Function "${funcName}" is missing required "stackName" property.`);
      }

      const stackName = funcConfig.stackName;
      const normalizedFuncName = this.plugin.provider.naming.getNormalizedFunctionName(funcName);

      if (!stackNameResourceMap.has(stackName)) {
        stackNameResourceMap.set(stackName, new Set());
      }

      stackNameResourceMap.get(stackName).add(normalizedFuncName);
    });

    return stackNameResourceMap;
  }

  getStackNameForLambda(normalizedLambdaName) {
    for (const [stackName, lambdaSet] of this.stackNameResourceMap.entries()) {
      if (lambdaSet.has(normalizedLambdaName)) {
        return stackName;
      }
    }
    return undefined;
  }

  getAllNormalizedLambdaNames(serverless) {
    return Object.keys(serverless.service.functions)
      .map(lambdaName => this.plugin.provider.naming.getNormalizedFunctionName(lambdaName))
      .sort((normalizedName1, normalizedName2) => normalizedName2.length - normalizedName1.length);
  }

  getApiGatewayResourceMap(serverless) {
    const apiGatewayPlugin = serverless.pluginManager.plugins.find(
      plugin => plugin.constructor.name === 'AwsCompileApigEvents'
    );

    if (!apiGatewayPlugin) {
      return new Map();
    }

    const resourceMap = new Map();
    const resourceLambdasMap = new Map();

    apiGatewayPlugin.validated.events.forEach(({ functionName, http }) => {
      const normalizedLambdaName = this.plugin.provider.naming.getNormalizedFunctionName(functionName);

      // Map API Gateway Methods
      resourceMap.set(
        this.plugin.provider.naming.getMethodLogicalId(
          apiGatewayPlugin.getResourceName(http.path),
          http.method
        ),
        normalizedLambdaName
      );

      // Handle OPTIONS method for CORS
      const optionsResourceName = this.plugin.provider.naming.getMethodLogicalId(
        apiGatewayPlugin.getResourceName(http.path),
        'OPTIONS'
      );
      if (!resourceLambdasMap.has(optionsResourceName)) {
        resourceLambdasMap.set(optionsResourceName, new Set());
      }
      resourceLambdasMap.get(optionsResourceName).add(normalizedLambdaName);

      // Map API Gateway Resources
      const tokens = [];
      http.path.split('/').forEach(token => {
        tokens.push(token);
        const resourceName = this.plugin.provider.naming.getResourceLogicalId(tokens.join('/'));
        if (!resourceLambdasMap.has(resourceName)) {
          resourceLambdasMap.set(resourceName, new Set());
        }
        resourceLambdasMap.get(resourceName).add(normalizedLambdaName);
      });
    });

    // Check if resources are used by functions in the same stack
    resourceLambdasMap.forEach((normalizedFunctionNames, resourceName) => {
      // Get all stacks that use this resource
      const stacksUsingResource = new Set();
      normalizedFunctionNames.forEach(lambdaName => {
        const stackName = this.getStackNameForLambda(lambdaName);
        if (stackName) {
          stacksUsingResource.add(stackName);
        }
      });

      // If all functions using this resource are in the same stack, map it to that stack
      if (stacksUsingResource.size === 1) {
        const lambdaName = normalizedFunctionNames.values().next().value;
        resourceMap.set(resourceName, lambdaName);
      } else {
        console.log(`Resource ${resourceName} is used across multiple stacks:`, Array.from(stacksUsingResource));
      }
    });

    return resourceMap;
  }

  getApiGatewayDestination(logicalId) {
    return this.apiGatewayResourceMap.get(logicalId);
  }

  getLambdaDestination(logicalId) {
    return this.lambdaNames.find(normalizedLambdaName => {
      return logicalId.startsWith(normalizedLambdaName);
    });
  }

  getDestination(resource, logicalId) {
    let normalizedLambdaName;

    if (['AWS::ApiGateway::Method', 'AWS::ApiGateway::Resource'].includes(resource.Type)) {
      normalizedLambdaName = this.getApiGatewayDestination(logicalId);
    } else {
      normalizedLambdaName = this.getLambdaDestination(logicalId);
    }

    if (normalizedLambdaName) {
      const stackName = this.getStackNameForLambda(normalizedLambdaName);
      if (stackName) {
        return { destination: stackName };
      }
    }

    return undefined; // Let base strategy handle default to root
  }

  isStrategyActive() {
    return !!this.plugin.config.perCustomGroup;
  }

  getStackGroups() {
    if (!this.isStrategyActive()) {
      return {};
    }
    return this.stackNameResourceMap;
  }
};
