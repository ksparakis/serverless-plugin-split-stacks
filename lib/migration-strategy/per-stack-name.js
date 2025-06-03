'use strict';

const BaseStrategy = require('./base-strategy');

module.exports = class PerStackNameStrategy extends BaseStrategy {
    constructor(plugin) {
        super(plugin);
        this.stackGroups = {};
        this.functionStackMap = new Map();
        this.apiGatewayResourceMap = new Map();

        if (this.isStrategyActive()) {
            this.initializeApiGatewayMap();
        }
    }

    isStrategyActive() {
        return this.plugin.config.perStackName;
    }

    initializeApiGatewayMap() {
        // Find the API Gateway plugin
        const pluginManager = this.plugin.serverless.pluginManager;
        if (!pluginManager || !pluginManager.plugins) return;

        const apiGatewayPlugin = pluginManager.plugins.find(
            plugin => plugin.constructor.name === 'AwsCompileApigEvents'
        );

        if (!apiGatewayPlugin || !apiGatewayPlugin.validated || !apiGatewayPlugin.validated.events) return;

        // Map API Gateway resources to their functions
        apiGatewayPlugin.validated.events.forEach(({ functionName, http }) => {
            const functionConfig = this.plugin.serverless.service.functions[functionName];
            if (!functionConfig || !functionConfig.stackName) return;

            const stackName = functionConfig.stackName;
            this.functionStackMap.set(functionName, stackName);

            // Map the HTTP method
            const methodLogicalId = this.plugin.provider.naming.getMethodLogicalId(
                apiGatewayPlugin.getResourceName(http.path),
                http.method
            );
            this.apiGatewayResourceMap.set(methodLogicalId, stackName);

            // Map OPTIONS method for CORS
            const optionsMethodLogicalId = this.plugin.provider.naming.getMethodLogicalId(
                apiGatewayPlugin.getResourceName(http.path),
                'OPTIONS'
            );
            this.apiGatewayResourceMap.set(optionsMethodLogicalId, stackName);

            // Map the API Gateway resources for the path
            const tokens = [];
            http.path.split('/').forEach(token => {
                tokens.push(token);
                const resourceLogicalId = this.plugin.provider.naming.getResourceLogicalId(tokens.join('/'));
                this.apiGatewayResourceMap.set(resourceLogicalId, stackName);
            });
        });
    }

    getDestination(resource, logicalId) {
        if (!this.isStrategyActive()) {
            return null;
        }
        // Handle Lambda functions
        if (resource.Type === 'AWS::Lambda::Function') {
            const functionName = logicalId.replace('LambdaFunction', '');
            const functionConfig = this.plugin.serverless.service.functions[functionName];

            if (!functionConfig) {
                return null;
            }

            if (!functionConfig.stackName) {
                throw new Error(`Function ${functionName} must have a stackName defined when using perStackName strategy`);
            }

            const stackName = functionConfig.stackName;
            return this.addToStackGroup(stackName, logicalId);
        }

        // Handle API Gateway resources
        if (['AWS::ApiGateway::Method', 'AWS::ApiGateway::Resource'].includes(resource.Type)) {
            const stackName = this.apiGatewayResourceMap.get(logicalId);
            if (stackName) {
                return this.addToStackGroup(stackName, logicalId);
            }
        }

        // Handle other Lambda-related resources
        if (this.plugin.provider && this.plugin.provider.naming && typeof this.plugin.provider.naming.getNormalizedFunctionName === 'function') {
            const normalizedFunctionName = this.plugin.provider.naming.getNormalizedFunctionName(logicalId);
            if (normalizedFunctionName) {
                const functionName = Object.keys(this.plugin.serverless.service.functions).find(
                    name => this.plugin.provider.naming.getNormalizedFunctionName(name) === normalizedFunctionName
                );
                if (functionName) {
                    const stackName = this.functionStackMap.get(functionName);
                    if (stackName) {
                        return this.addToStackGroup(stackName, logicalId);
                    }
                }
            }
        }

        return null;
    }

    addToStackGroup(stackName, logicalId) {
        // Create a stack group if it doesn't exist
        if (!this.stackGroups[stackName]) {
            // Ensure the stack name is valid for CloudFormation
            // 1. Replace non-alphanumeric chars with hyphens
            // 2. Replace multiple hyphens with single hyphen
            // 3. Remove leading/trailing hyphens
            // 4. Ensure it starts with a letter
            let validStackName = stackName
                .replace(/[^a-zA-Z0-9-]/g, '-') // Replace non-alphanumeric chars with hyphens
                .replace(/-+/g, '-')           // Replace multiple hyphens with single hyphen
                .replace(/^-|-$/g, '');        // Remove leading/trailing hyphens

            // If the name doesn't start with a letter, prefix it with 'stack'
            if (!/^[a-zA-Z]/.test(validStackName)) {
                validStackName = `stack${validStackName}`;
            }

            this.stackGroups[stackName] = {
                destination: validStackName,
                resources: []
            };
        }

        // Add the resource to the stack group
        this.stackGroups[stackName].resources.push(logicalId);

        return {
            destination: this.stackGroups[stackName].destination,
            reason: `Grouped by stackName: ${stackName}`
        };
    }

    getStackGroups() {
        return this.stackGroups;
    }
}; 