'use strict';

const BaseStrategy = require('./base-strategy');

module.exports = class PerStackNameStrategy extends BaseStrategy {
    constructor(plugin) {
        super(plugin);
        this.stackGroups = new Map();
        this.lambdaNames = [];
        this.apiGatewayResourceMap = new Map();
        this.resourceAssignments = new Map(); // Track which resources are assigned to which groups

        if (this.isStrategyActive()) {
            this.initializeMaps(plugin.serverless);
        }
    }

    initializeMaps(serverless) {
        if (!serverless || !serverless.service || !serverless.service.functions) {
            return;
        }
        // Only initialize if provider.naming exists
        if (this.plugin.provider && this.plugin.provider.naming && typeof this.plugin.provider.naming.getNormalizedFunctionName === 'function') {
            this.lambdaNames = Object.keys(serverless.service.functions)
                .map(lambdaName => this.plugin.provider.naming.getNormalizedFunctionName(lambdaName))
                .sort((normalizedName1, normalizedName2) => normalizedName2.length - normalizedName1.length);
        } else {
            this.lambdaNames = Object.keys(serverless.service.functions);
        }
        // Initialize API Gateway map if available
        if (serverless.pluginManager && serverless.pluginManager.plugins) {
            this.apiGatewayResourceMap = this.getApiGatewayResourceMap(serverless);
        }
    }

    isSharedResource(resource, logicalId) {
        // Check if this resource is already assigned to multiple groups
        if (this.resourceAssignments.has(logicalId) && this.resourceAssignments.get(logicalId).size > 1) {
            return true;
        }

        // Keep in root stack only specific system resources:
        // - IAM Roles (customRole, IamRoleLambdaExecution, IamRoleCustomResourcesLambdaExecution)
        // - API Gateway REST API
        // - Serverless deployment bucket and policy
        return (
            resource.Type === 'AWS::IAM::Role' ||
            logicalId.startsWith('IamRole') ||
            logicalId === 'ApiGatewayRestApi' ||
            logicalId === 'ServerlessDeploymentBucket' ||
            logicalId === 'ServerlessDeploymentBucketPolicy'
        );
    }

    isApiGatewayResource(resource) {
        return ['AWS::ApiGateway::Method', 'AWS::ApiGateway::Resource'].indexOf(resource.Type) !== -1;
    }

    isLambdaResource(resource) {
        return resource.Type.startsWith('AWS::Lambda::') ||
            resource.Type === 'AWS::Logs::LogGroup' ||
            resource.Type === 'AWS::ApiGateway::Method' ||
            resource.Type === 'AWS::ApiGateway::Resource';
    }

    getApiGatewayDestination(logicalId) {
        const normalizedLambdaName = this.apiGatewayResourceMap.get(logicalId);
        if (!normalizedLambdaName) return null;

        // Find the function config to get its stackName
        const functionName = Object.keys(this.plugin.serverless.service.functions).find(
            name => this.plugin.provider.naming.getNormalizedFunctionName(name) === normalizedLambdaName
        );

        if (!functionName) return null;

        const functionConfig = this.plugin.serverless.service.functions[functionName];
        if (!functionConfig || !functionConfig.stackName) {
            throw new Error(`Function ${functionName} must have a stackName defined when using perStackName strategy`);
        }

        return functionConfig.stackName;
    }

    getLambdaDestination(logicalId) {
        // Find the function name that this resource belongs to
        const normalizedLambdaName = this.lambdaNames.find(normalizedLambdaName => {
            return logicalId.startsWith(normalizedLambdaName);
        });

        if (!normalizedLambdaName) return null;

        // Find the original function name and its config
        const functionName = Object.keys(this.plugin.serverless.service.functions).find(
            name => this.plugin.provider.naming.getNormalizedFunctionName(name) === normalizedLambdaName
        );

        if (!functionName) return null;

        const functionConfig = this.plugin.serverless.service.functions[functionName];
        if (!functionConfig || !functionConfig.stackName) {
            throw new Error(`Function ${functionName} must have a stackName defined when using perStackName strategy`);
        }

        return functionConfig.stackName;
    }

    getApiGatewayResourceMap(serverless) {
        // AwsCompileApigEvents plugin provides access to data maps and methods
        const apiGatewayPlugin = serverless.pluginManager.plugins.find(
            plugin => plugin.constructor.name === 'AwsCompileApigEvents'
        );

        if (!apiGatewayPlugin || !apiGatewayPlugin.validated || !apiGatewayPlugin.validated.events) {
            return new Map();
        }

        // Result map: resource id to normalized function name
        const resourceMap = new Map();

        // Iterate over all configured HTTP endpoints
        apiGatewayPlugin.validated.events.forEach(({ functionName, http }) => {
            const normalizedLambdaName = this.plugin.provider.naming.getNormalizedFunctionName(functionName);

            // Map the HTTP method
            resourceMap.set(
                this.plugin.provider.naming.getMethodLogicalId(
                    apiGatewayPlugin.getResourceName(http.path),
                    http.method
                ),
                normalizedLambdaName
            );

            // Map OPTIONS method for CORS
            resourceMap.set(
                this.plugin.provider.naming.getMethodLogicalId(
                    apiGatewayPlugin.getResourceName(http.path),
                    'OPTIONS'
                ),
                normalizedLambdaName
            );

            // Map the API Gateway resources for the path
            const tokens = [];
            http.path.split('/').forEach(token => {
                tokens.push(token);
                const resourceName = this.plugin.provider.naming.getResourceLogicalId(tokens.join('/'));
                resourceMap.set(resourceName, normalizedLambdaName);
            });
        });

        return resourceMap;
    }

    getDestination(resource, logicalId) {
        // Special handling for API Gateway Resource: check if shared
        if (resource.Type === 'AWS::ApiGateway::Resource') {
            const plugins = this.plugin.serverless.pluginManager.plugins;
            const apiGatewayPlugin = plugins && plugins.find(p => p.constructor && p.constructor.name === 'AwsCompileApigEvents');
            const events = apiGatewayPlugin && apiGatewayPlugin.validated && apiGatewayPlugin.validated.events;
            if (!events) {
                return null; // Defensive: if no events, keep in root stack
            }
            const functionsUsingPath = events.filter(e => e.http && e.http.path === logicalId).map(e => e.functionName);
            if (functionsUsingPath.length > 1) {
                return null; // Shared API Gateway resource, keep in root stack
            }
            if (functionsUsingPath.length === 1) {
                const functionName = functionsUsingPath[0];
                const stackName = this.plugin.serverless.service.functions[functionName].stackName;
                if (!stackName) {
                    throw new Error(`Function ${functionName} must have a stackName defined when using perStackName strategy`);
                }
                // Track resources in stack groups
                if (!this.stackGroups.has(stackName)) {
                    this.stackGroups.set(stackName, {
                        resources: [],
                        reason: `Grouped by stackName: ${stackName}`
                    });
                }
                this.stackGroups.get(stackName).resources.push(logicalId);
                return {
                    destination: this.getNestedStackName(stackName),
                    reason: `Grouped by stackName: ${stackName}`
                };
            }
            // If not referenced by any function, keep in root
            return null;
        }
        // Only migrate Lambda resources and their direct dependencies, or uniquely associated API Gateway resources
        let stackName;
        if (this.isApiGatewayResource(resource)) {
            stackName = this.getApiGatewayDestination(logicalId);
        } else if (this.isLambdaResource(resource)) {
            stackName = this.getLambdaDestination(logicalId);
        } else {
            // All other resources stay in the root stack
            return null;
        }

        if (stackName) {
            // Track resources in stack groups
            if (!this.stackGroups.has(stackName)) {
                this.stackGroups.set(stackName, {
                    resources: [],
                    reason: `Grouped by stackName: ${stackName}`
                });
            }
            this.stackGroups.get(stackName).resources.push(logicalId);

            return {
                destination: this.getNestedStackName(stackName),
                reason: `Grouped by stackName: ${stackName}`
            };
        }

        // If no stack name was found, keep in root
        return null;
    }

    isStrategyActive() {
        return this.plugin.config.perStackName;
    }

    getNestedStackName(stackName) {
        // Ensure the stack name is valid for CloudFormation
        let validStackName = stackName
            .replace(/[^a-zA-Z0-9-]/g, '-')  // Replace non-alphanumeric chars with hyphens
            .replace(/-+/g, '-')            // Replace multiple hyphens with single hyphen
            .replace(/^-|-$/g, '');         // Remove leading/trailing hyphens

        // Capitalize the first letter to match Lambda logical ID convention
        validStackName = validStackName.charAt(0).toUpperCase() + validStackName.slice(1);

        // If the name doesn't start with a letter, prefix it with 'Stack'
        if (!/^[a-zA-Z]/.test(validStackName)) {
            validStackName = `Stack${validStackName}`;
        }

        return validStackName;
    }

    getStackGroups() {
        if (!this.stackGroups || typeof this.stackGroups[Symbol.iterator] !== 'function') {
            return {};
        }
        return Object.fromEntries(this.stackGroups);
    }
}; 