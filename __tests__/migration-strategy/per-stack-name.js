const test = require('ava');
const PerStackName = require('../../lib/migration-strategy/per-stack-name');

test('should be disabled by default', t => {
    const plugin = {
        config: {},
        provider: {
            naming: {
                getNormalizedFunctionName: name => name
            }
        },
        serverless: {
            pluginManager: {
                plugins: []
            }
        }
    };
    const strategy = new PerStackName(plugin);
    t.false(strategy.isStrategyActive());
});

test('should be enabled when perCustomGroup is true', t => {
    const plugin = {
        config: {
            perCustomGroup: true
        },
        provider: {
            naming: {
                getNormalizedFunctionName: name => name
            }
        },
        serverless: {
            service: {
                functions: {
                    func1: { stackName: 'stack1' },
                    func2: { stackName: 'stack2' }
                }
            },
            pluginManager: {
                plugins: []
            }
        }
    };
    const strategy = new PerStackName(plugin);
    t.true(strategy.isStrategyActive());
});

test('should throw error if function is missing stackName property', t => {
    const plugin = {
        config: {
            perCustomGroup: true
        },
        provider: {
            naming: {
                getNormalizedFunctionName: name => name
            }
        },
        serverless: {
            service: {
                functions: {
                    func1: {} // Missing stackName
                }
            },
            pluginManager: {
                plugins: []
            }
        }
    };
    t.throws(() => new PerStackName(plugin), {
        message: 'Function "func1" is missing required "stackName" property.'
    });
});

test('should correctly map functions to their stacks', t => {
    const plugin = {
        config: {
            perCustomGroup: true
        },
        provider: {
            naming: {
                getNormalizedFunctionName: name => name
            }
        },
        serverless: {
            service: {
                functions: {
                    func1: { stackName: 'stack1' },
                    func2: { stackName: 'stack1' },
                    func3: { stackName: 'stack2' }
                }
            },
            pluginManager: {
                plugins: []
            }
        }
    };
    const strategy = new PerStackName(plugin);
    const stackGroups = strategy.getStackGroups();

    t.is(stackGroups.get('stack1').size, 2);
    t.is(stackGroups.get('stack2').size, 1);
    t.true(stackGroups.get('stack1').has('func1'));
    t.true(stackGroups.get('stack1').has('func2'));
    t.true(stackGroups.get('stack2').has('func3'));
});

test('should handle API Gateway resources in the same stack', t => {
    const plugin = {
        config: {
            perCustomGroup: true
        },
        provider: {
            naming: {
                getNormalizedFunctionName: name => name,
                getMethodLogicalId: (path, method) => `${path}-${method}`,
                getResourceLogicalId: path => `Resource-${path}`
            }
        },
        serverless: {
            service: {
                functions: {
                    func1: { stackName: 'stack1' }
                }
            },
            pluginManager: {
                plugins: [{
                    constructor: { name: 'AwsCompileApigEvents' },
                    validated: {
                        events: [{
                            functionName: 'func1',
                            http: {
                                path: '/test',
                                method: 'GET'
                            }
                        }]
                    },
                    getResourceName: path => path
                }]
            }
        }
    };
    const strategy = new PerStackName(plugin);
    const destination = strategy.getDestination(
        { Type: 'AWS::ApiGateway::Method' },
        '/test-GET'
    );
    t.deepEqual(destination, { destination: 'stack1' });
});

test('should handle API Gateway resources across multiple stacks', t => {
    const plugin = {
        config: {
            perCustomGroup: true
        },
        provider: {
            naming: {
                getNormalizedFunctionName: name => name,
                getMethodLogicalId: (path, method) => `${path}-${method}`,
                getResourceLogicalId: path => `Resource-${path}`
            }
        },
        serverless: {
            service: {
                functions: {
                    func1: { stackName: 'stack1' },
                    func2: { stackName: 'stack2' }
                }
            },
            pluginManager: {
                plugins: [{
                    constructor: { name: 'AwsCompileApigEvents' },
                    validated: {
                        events: [
                            {
                                functionName: 'func1',
                                http: {
                                    path: '/test',
                                    method: 'GET'
                                }
                            },
                            {
                                functionName: 'func2',
                                http: {
                                    path: '/test',
                                    method: 'POST'
                                }
                            }
                        ]
                    },
                    getResourceName: path => path
                }]
            }
        }
    };
    const strategy = new PerStackName(plugin);
    const destination = strategy.getDestination(
        { Type: 'AWS::ApiGateway::Resource' },
        'Resource-/test'
    );
    t.is(destination, undefined);
});

test('should handle Lambda resources', t => {
    const plugin = {
        config: {
            perCustomGroup: true
        },
        provider: {
            naming: {
                getNormalizedFunctionName: name => name
            }
        },
        serverless: {
            service: {
                functions: {
                    func1: { stackName: 'stack1' }
                }
            },
            pluginManager: {
                plugins: []
            }
        }
    };
    const strategy = new PerStackName(plugin);
    const destination = strategy.getDestination(
        { Type: 'AWS::Lambda::Function' },
        'func1'
    );
    t.deepEqual(destination, { destination: 'stack1' });
});

test('should return undefined for unknown resource types', t => {
    const plugin = {
        config: {
            perCustomGroup: true
        },
        provider: {
            naming: {
                getNormalizedFunctionName: name => name
            }
        },
        serverless: {
            service: {
                functions: {
                    func1: { stackName: 'stack1' }
                }
            },
            pluginManager: {
                plugins: []
            }
        }
    };
    const strategy = new PerStackName(plugin);
    const destination = strategy.getDestination(
        { Type: 'AWS::S3::Bucket' },
        'my-bucket'
    );
    t.is(destination, undefined);
});

test('should return empty object when strategy is disabled', t => {
    const plugin = {
        config: {},
        provider: {
            naming: {
                getNormalizedFunctionName: name => name
            }
        },
        serverless: {
            pluginManager: {
                plugins: []
            }
        }
    };
    const strategy = new PerStackName(plugin);
    t.deepEqual(strategy.getStackGroups(), {});
});
