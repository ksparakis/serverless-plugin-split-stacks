'use strict';

const test = require('ava');
const PerStackNameStrategy = require('../../lib/migration-strategy/per-stack-name');

test('plugin constructor throws error when perStackName enabled and function missing stackName', t => {
    const plugin = {
        config: { perStackName: true },
        serverless: {
            service: {
                functions: {
                    func1: {}
                }
            }
        }
    };
    const strategy = new PerStackNameStrategy(plugin);
    t.throws(() => {
        strategy.getDestination({ Type: 'AWS::Lambda::Function' }, 'func1LambdaFunction');
    }, { message: 'Function func1 must have a stackName defined when using perStackName strategy' });
});

test('plugin constructor does not throw when perStackName disabled', t => {
    const plugin = {
        config: { perStackName: false },
        serverless: {
            service: {
                functions: {
                    func1: {}
                }
            }
        }
    };

    t.notThrows(() => {
        new PerStackNameStrategy(plugin);
    });
});

test('strategy throws error for functions without stackName', t => {
    const plugin = {
        config: { perStackName: true },
        serverless: {
            service: {
                functions: {
                    func1: { stackName: 'group1' },
                    func2: {}
                }
            }
        }
    };

    const strategy = new PerStackNameStrategy(plugin);
    t.throws(() => {
        strategy.getDestination({ Type: 'AWS::Lambda::Function' }, 'func2LambdaFunction');
    }, { message: 'Function func2 must have a stackName defined when using perStackName strategy' });
});

test('can be disabled', t => {
    const plugin = {
        config: { perStackName: false },
        serverless: {
            service: {
                functions: {
                    func1: { stackName: 'group1' }
                }
            }
        }
    };

    const strategy = new PerStackNameStrategy(plugin);
    t.falsy(strategy.isStrategyActive());
});

test('initializes if enabled', t => {
    const plugin = {
        config: { perStackName: true },
        serverless: {
            service: {
                functions: {
                    func1: { stackName: 'group1' }
                }
            }
        }
    };

    const strategy = new PerStackNameStrategy(plugin);
    t.truthy(strategy.isStrategyActive());
});

test('does not migrate resources if disabled', t => {
    const plugin = {
        config: { perStackName: false },
        serverless: {
            service: {
                functions: {
                    func1: { stackName: 'group1' }
                }
            }
        }
    };

    const strategy = new PerStackNameStrategy(plugin);
    const result = strategy.getDestination({ Type: 'AWS::Lambda::Function' }, 'func1LambdaFunction');
    t.falsy(result);
});

test('does not migrate non-lambda resources', t => {
    const plugin = {
        config: { perStackName: true },
        serverless: {
            service: {
                functions: {
                    func1: { stackName: 'group1' }
                }
            }
        }
    };

    const strategy = new PerStackNameStrategy(plugin);
    const result = strategy.getDestination({ Type: 'AWS::S3::Bucket' }, 'MyBucket');
    t.falsy(result);
});

test('migrates functions to correct stack based on stackName', t => {
    const plugin = {
        config: { perStackName: true },
        serverless: {
            service: {
                functions: {
                    func1: { stackName: 'group1' },
                    func2: { stackName: 'group2' }
                }
            }
        }
    };

    const strategy = new PerStackNameStrategy(plugin);

    // Test first function
    const migration1 = strategy.getDestination({ Type: 'AWS::Lambda::Function' }, 'func1LambdaFunction');
    t.truthy(migration1);
    t.is(migration1.destination, 'group1');
    t.is(migration1.reason, 'Grouped by stackName: group1');

    // Test second function
    const migration2 = strategy.getDestination({ Type: 'AWS::Lambda::Function' }, 'func2LambdaFunction');
    t.truthy(migration2);
    t.is(migration2.destination, 'group2');
    t.is(migration2.reason, 'Grouped by stackName: group2');

    // Test that both functions are in the same stack group
    const stackGroups = strategy.getStackGroups();
    t.truthy(stackGroups['group1']);
    t.truthy(stackGroups['group2']);
    t.deepEqual(stackGroups['group1'].resources, ['func1LambdaFunction']);
    t.deepEqual(stackGroups['group2'].resources, ['func2LambdaFunction']);
}); 