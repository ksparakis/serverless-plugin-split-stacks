'use strict';

const test = require('ava');
const ServerlessPluginSplitStacks = require('../../split-stacks');

const PerStackName = require('../../lib/migration-strategy/per-stack-name');

test.beforeEach(t => {
    const plugin = {
        config: {},
        serverless: {
            service: {
                functions: {
                    'function1': {
                        handler: 'handler.function1',
                        stackName: 'group1'
                    },
                    'function2': {
                        handler: 'handler.function2',
                        stackName: 'group1'
                    },
                    'function3': {
                        handler: 'handler.function3',
                        stackName: 'group2'
                    },
                    'function4': {
                        handler: 'handler.function4'
                        // No stackName defined
                    }
                }
            }
        },
        getStackName: () => 'test'
    };
    t.context = Object.assign({}, { plugin });
});

test('plugin constructor throws error when perStackName enabled and function missing stackName', t => {
    const serverless = {
        version: '1.13.0',
        getProvider: () => ({
            request: () => Promise.resolve(),
            getServerlessDeploymentBucketName: () => Promise.resolve('test-bucket')
        }),
        service: {
            custom: {
                splitStacks: {
                    perStackName: true
                }
            },
            functions: {
                'function1': {
                    handler: 'handler.function1',
                    stackName: 'group1'
                },
                'function2': {
                    handler: 'handler.function2'
                    // Missing stackName
                }
            },
            provider: {
                compiledCloudFormationTemplate: {
                    Resources: {}
                }
            }
        }
    };

    const error = t.throws(() => {
        new ServerlessPluginSplitStacks(serverless);
    }, { instanceOf: Error });

    t.is(
        error.message,
        'Function "function2" must have a stackName defined when using perStackName strategy. Please add a stackName to all functions or disable the perStackName strategy.'
    );
});

test('plugin constructor does not throw when perStackName disabled', t => {
    const serverless = {
        version: '1.13.0',
        getProvider: () => ({
            request: () => Promise.resolve(),
            getServerlessDeploymentBucketName: () => Promise.resolve('test-bucket')
        }),
        service: {
            custom: {
                splitStacks: {
                    perStackName: false
                }
            },
            functions: {
                'function1': {
                    handler: 'handler.function1'
                    // Missing stackName but strategy is disabled
                }
            },
            provider: {
                compiledCloudFormationTemplate: {
                    Resources: {}
                }
            }
        }
    };

    t.notThrows(() => {
        new ServerlessPluginSplitStacks(serverless);
    });
});

test('strategy throws error for functions without stackName', t => {
    t.context.plugin.config.perStackName = true;

    const migrationStrategy = new PerStackName(t.context.plugin);
    const resource = {
        Type: 'AWS::Lambda::Function'
    };

    const error = t.throws(() => {
        migrationStrategy.migration(resource, 'function4LambdaFunction');
    }, { instanceOf: Error });

    t.is(error.message, 'Function function4 must have a stackName defined when using perStackName strategy');
});

test('can be disabled', t => {
    t.context.plugin.config.perStackName = false;

    const migrationStrategy = new PerStackName(t.context.plugin);
    const resource = {
        Type: 'AWS::Lambda::Function'
    };

    const migration = migrationStrategy.migration(resource, 'function1LambdaFunction');
    t.falsy(migration);
});

test('initializes if enabled', t => {
    t.context.plugin.config.perStackName = true;

    const migrationStrategy = new PerStackName(t.context.plugin);

    t.truthy(migrationStrategy.stackGroups);
});

test('does not migrate resources if disabled', t => {
    t.context.plugin.config.perStackName = false;

    const migrationStrategy = new PerStackName(t.context.plugin);
    const resource = {
        Type: 'AWS::Lambda::Function'
    };

    const migration = migrationStrategy.migration(resource, 'function1LambdaFunction');
    t.falsy(migration);
});

test('does not migrate non-lambda resources', t => {
    t.context.plugin.config.perStackName = true;

    const migrationStrategy = new PerStackName(t.context.plugin);
    const resource = {
        Type: 'AWS::DynamoDB::Table'
    };

    const migration = migrationStrategy.migration(resource, 'MyTable');
    t.falsy(migration);
});

test('migrates functions to correct stack based on stackName', t => {
    t.context.plugin.config.perStackName = true;

    const migrationStrategy = new PerStackName(t.context.plugin);
    const resource = {
        Type: 'AWS::Lambda::Function'
    };

    // Test function1 (group1)
    const migration1 = migrationStrategy.migration(resource, 'function1LambdaFunction');
    t.truthy(migration1);
    t.is(migration1.destination, 'stack-group1');
    t.is(migration1.reason, 'Grouped by stackName: group1');

    // Test function2 (group1)
    const migration2 = migrationStrategy.migration(resource, 'function2LambdaFunction');
    t.truthy(migration2);
    t.is(migration2.destination, 'stack-group1');
    t.is(migration2.reason, 'Grouped by stackName: group1');

    // Test function3 (group2)
    const migration3 = migrationStrategy.migration(resource, 'function3LambdaFunction');
    t.truthy(migration3);
    t.is(migration3.destination, 'stack-group2');
    t.is(migration3.reason, 'Grouped by stackName: group2');
}); 