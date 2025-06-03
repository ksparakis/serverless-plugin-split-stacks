'use strict';

const BaseStrategy = require('./base-strategy');

module.exports = class PerStackNameStrategy extends BaseStrategy {
    constructor(plugin) {
        super(plugin);
        this.stackGroups = {};
    }

    isStrategyActive() {
        return this.plugin.config.perStackName === true;
    }

    getDestination(resource, logicalId) {
        // Only process Lambda functions
        if (resource.Type !== 'AWS::Lambda::Function') {
            return null;
        }

        // Get the function name from the logical ID
        const functionName = logicalId.replace('LambdaFunction', '');

        // Get the function configuration from serverless
        const functionConfig = this.plugin.serverless.service.functions[functionName];

        if (!functionConfig) {
            return null;
        }

        if (!functionConfig.stackName) {
            throw new Error(`Function ${functionName} must have a stackName defined when using perStackName strategy`);
        }

        const stackName = functionConfig.stackName;

        // Create a stack group if it doesn't exist
        if (!this.stackGroups[stackName]) {
            this.stackGroups[stackName] = {
                destination: `stack-${stackName}`,
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
}; 