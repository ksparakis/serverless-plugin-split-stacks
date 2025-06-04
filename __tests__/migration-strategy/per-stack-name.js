'use strict';

const sinon = require('sinon');
const test = require('ava');
const PerStackNameStrategy = require('../../lib/migration-strategy/per-stack-name');

test.beforeEach(t => {
    const apiGatewayPlugin = {
        constructor: { name: 'AwsCompileApigEvents' },
        validated: { events: [] },
        getResourceName: sinon.stub().returnsArg(0)
    };

    const plugin = {
        config: {},
        serverless: {
            config: { servicePath: __dirname },
            pluginManager: { plugins: [apiGatewayPlugin] },
            service: { functions: {} }
        },
        provider: {
            naming: {
                getNormalizedFunctionName: sinon.stub().returnsArg(0),
                getMethodLogicalId: sinon.stub().callsFake((name, method) => name + method),
                getResourceLogicalId: sinon.stub().returnsArg(0)
            }
        }
    };
    t.context = { plugin };
});

test('can be disabled', t => {
    t.context.plugin.config.perStackName = false;
    t.context.plugin.serverless.service.functions = { func1: { stackName: 'group1' } };
    const strategy = new PerStackNameStrategy(t.context.plugin);
    t.falsy(strategy.isStrategyActive());
});

test('initializes if enabled', t => {
    t.context.plugin.config.perStackName = true;
    t.context.plugin.serverless.service.functions = { func1: { stackName: 'group1' } };
    const strategy = new PerStackNameStrategy(t.context.plugin);
    t.truthy(strategy.isStrategyActive());
});

test('plugin constructor throws error when perStackName enabled and function missing stackName', t => {
    t.context.plugin.config.perStackName = true;
    t.context.plugin.serverless.service.functions = { func1: {} };
    const strategy = new PerStackNameStrategy(t.context.plugin);
    t.throws(() => {
        strategy.getDestination({ Type: 'AWS::Lambda::Function' }, 'func1LambdaFunction');
    }, { message: 'Function func1 must have a stackName defined when using perStackName strategy' });
});

test('plugin constructor does not throw when perStackName disabled', t => {
    t.context.plugin.config.perStackName = false;
    t.context.plugin.serverless.service.functions = { func1: {} };
    t.notThrows(() => {
        new PerStackNameStrategy(t.context.plugin);
    });
});

test('strategy throws error for functions without stackName', t => {
    t.context.plugin.config.perStackName = true;
    t.context.plugin.serverless.service.functions = {
        func1: { stackName: 'group1' },
        func2: {}
    };
    const strategy = new PerStackNameStrategy(t.context.plugin);
    t.throws(() => {
        strategy.getDestination({ Type: 'AWS::Lambda::Function' }, 'func2LambdaFunction');
    }, { message: 'Function func2 must have a stackName defined when using perStackName strategy' });
});

test('does not migrate resources if disabled', t => {
    t.context.plugin.config.perStackName = false;
    t.context.plugin.serverless.service.functions = { func1: { stackName: 'group1' } };
    const strategy = new PerStackNameStrategy(t.context.plugin);
    const result = strategy.getDestination({ Type: 'AWS::Lambda::Function' }, 'func1LambdaFunction');
    t.falsy(result);
});

test('does not migrate non-lambda resources', t => {
    t.context.plugin.config.perStackName = true;
    t.context.plugin.serverless.service.functions = { func1: { stackName: 'group1' } };
    const strategy = new PerStackNameStrategy(t.context.plugin);
    const result = strategy.getDestination({ Type: 'AWS::S3::Bucket' }, 'MyBucket');
    t.falsy(result);
});

test('migrates functions to correct stack based on stackName', t => {
    t.context.plugin.config.perStackName = true;
    t.context.plugin.serverless.service.functions = {
        func1: { stackName: 'group1' },
        func2: { stackName: 'group2' }
    };
    const strategy = new PerStackNameStrategy(t.context.plugin);
    const migration1 = strategy.getDestination({ Type: 'AWS::Lambda::Function' }, 'func1LambdaFunction');
    t.truthy(migration1);
    t.is(migration1.destination, strategy.getNestedStackName('group1'));
    t.is(migration1.reason, 'Grouped by stackName: group1');
    const migration2 = strategy.getDestination({ Type: 'AWS::Lambda::Function' }, 'func2LambdaFunction');
    t.truthy(migration2);
    t.is(migration2.destination, strategy.getNestedStackName('group2'));
    t.is(migration2.reason, 'Grouped by stackName: group2');
    const stackGroups = strategy.getStackGroups();
    t.truthy(stackGroups['group1']);
    t.truthy(stackGroups['group2']);
    t.deepEqual(stackGroups['group1'].resources, ['func1LambdaFunction']);
    t.deepEqual(stackGroups['group2'].resources, ['func2LambdaFunction']);
});

test('migrates all related resources to the same stack', t => {
    t.context.plugin.config.perStackName = true;
    t.context.plugin.serverless.service.functions = { func1: { stackName: 'group1' } };
    const strategy = new PerStackNameStrategy(t.context.plugin);
    const functionMigration = strategy.getDestination({ Type: 'AWS::Lambda::Function' }, 'func1LambdaFunction');
    t.truthy(functionMigration);
    t.is(functionMigration.destination, strategy.getNestedStackName('group1'));
    const permissionMigration = strategy.getDestination({ Type: 'AWS::Lambda::Permission' }, 'func1LambdaPermissionApiGateway');
    t.truthy(permissionMigration);
    t.is(permissionMigration.destination, strategy.getNestedStackName('group1'));
    const versionMigration = strategy.getDestination({ Type: 'AWS::Lambda::Version' }, 'func1LambdaVersionXYZ');
    t.truthy(versionMigration);
    t.is(versionMigration.destination, strategy.getNestedStackName('group1'));
    const logGroupMigration = strategy.getDestination({ Type: 'AWS::Logs::LogGroup' }, 'func1LogGroup');
    t.truthy(logGroupMigration);
    t.is(logGroupMigration.destination, strategy.getNestedStackName('group1'));
    const stackGroups = strategy.getStackGroups();
    t.truthy(stackGroups['group1']);
    t.deepEqual(stackGroups['group1'].resources.sort(), [
        'func1LambdaFunction',
        'func1LambdaPermissionApiGateway',
        'func1LambdaVersionXYZ',
        'func1LogGroup'
    ].sort());
});

test('migrates all Lambda-related resources to the correct stack', t => {
    t.context.plugin.config.perStackName = true;
    t.context.plugin.serverless.service.functions = { func1: { stackName: 'group1' } };
    const strategy = new PerStackNameStrategy(t.context.plugin);
    const ids = [
        'func1LambdaFunction',
        'func1LambdaPermissionApiGateway',
        'func1LambdaVersionXYZ',
        'func1LogGroup'
    ];
    for (const id of ids) {
        const migration = strategy.getDestination({ Type: id.includes('LogGroup') ? 'AWS::Logs::LogGroup' : id.includes('Version') ? 'AWS::Lambda::Version' : id.includes('Permission') ? 'AWS::Lambda::Permission' : 'AWS::Lambda::Function' }, id);
        t.truthy(migration, id + ' should be migrated');
        t.is(migration.destination, strategy.getNestedStackName('group1'));
    }
    const stackGroups = strategy.getStackGroups();
    t.deepEqual(stackGroups['group1'].resources.sort(), ids.sort());
});

test('does not migrate S3 buckets, even if referenced by a single function', t => {
    t.context.plugin.config.perStackName = true;
    t.context.plugin.serverless.service.functions = { func1: { stackName: 'group1' } };
    const strategy = new PerStackNameStrategy(t.context.plugin);
    const migration = strategy.getDestination({ Type: 'AWS::S3::Bucket' }, 'MyBucket');
    t.falsy(migration);
});

test('does not migrate SNS topics, even if referenced by a single function', t => {
    t.context.plugin.config.perStackName = true;
    t.context.plugin.serverless.service.functions = { func1: { stackName: 'group1' } };
    const strategy = new PerStackNameStrategy(t.context.plugin);
    const migration = strategy.getDestination({ Type: 'AWS::SNS::Topic' }, 'MyTopic');
    t.falsy(migration);
});

test('does not migrate S3 buckets shared between multiple functions', t => {
    t.context.plugin.config.perStackName = true;
    t.context.plugin.serverless.service.functions = {
        func1: { stackName: 'group1' },
        func2: { stackName: 'group2' }
    };
    const strategy = new PerStackNameStrategy(t.context.plugin);
    // Simulate both functions referencing the same bucket
    let migration1 = strategy.getDestination({ Type: 'AWS::S3::Bucket' }, 'SharedBucket');
    t.falsy(migration1);
    let migration2 = strategy.getDestination({ Type: 'AWS::S3::Bucket' }, 'SharedBucket');
    t.falsy(migration2);
});

test('migrates API Gateway resources only if uniquely associated with a function', t => {
    t.context.plugin.config.perStackName = true;
    t.context.plugin.serverless.service.functions = {
        func1: { stackName: 'group1' },
        func2: { stackName: 'group2' }
    };
    t.context.plugin.serverless.pluginManager.plugins[0].validated.events = [
        { functionName: 'func1', http: { path: '/unique', method: 'GET' } },
        { functionName: 'func2', http: { path: '/shared', method: 'GET' } },
        { functionName: 'func1', http: { path: '/shared', method: 'GET' } }
    ];
    const strategy = new PerStackNameStrategy(t.context.plugin);
    // Unique resource
    let uniqueId = '/unique';
    let migrationUnique = strategy.getDestination({ Type: 'AWS::ApiGateway::Resource' }, uniqueId);
    t.truthy(migrationUnique);
    t.is(migrationUnique.destination, strategy.getNestedStackName('group1'));
    // Shared resource
    let sharedId = '/shared';
    let migrationShared = strategy.getDestination({ Type: 'AWS::ApiGateway::Resource' }, sharedId);
    t.falsy(migrationShared);
});

test('throws error if function is missing stackName', t => {
    t.context.plugin.config.perStackName = true;
    t.context.plugin.serverless.service.functions = { func1: {} };
    const strategy = new PerStackNameStrategy(t.context.plugin);
    t.throws(() => {
        strategy.getDestination({ Type: 'AWS::Lambda::Function' }, 'func1LambdaFunction');
    }, { message: 'Function func1 must have a stackName defined when using perStackName strategy' });
});

test('does not migrate anything if perStackName is disabled', t => {
    t.context.plugin.config.perStackName = false;
    t.context.plugin.serverless.service.functions = { func1: { stackName: 'group1' } };
    const strategy = new PerStackNameStrategy(t.context.plugin);
    const migration = strategy.getDestination({ Type: 'AWS::Lambda::Function' }, 'func1LambdaFunction');
    t.falsy(migration);
});

test('shared S3 bucket always stays in root stack', t => {
    t.context.plugin.config.perStackName = true;
    t.context.plugin.serverless.service.functions = {
        func1: { stackName: 'group1' },
        func2: { stackName: 'group2' }
    };
    const strategy = new PerStackNameStrategy(t.context.plugin);
    const migration = strategy.getDestination({ Type: 'AWS::S3::Bucket' }, 'SharedBucket');
    t.falsy(migration);
});

test('shared SNS topic always stays in root stack', t => {
    t.context.plugin.config.perStackName = true;
    t.context.plugin.serverless.service.functions = {
        func1: { stackName: 'group1' },
        func2: { stackName: 'group2' }
    };
    const strategy = new PerStackNameStrategy(t.context.plugin);
    const migration = strategy.getDestination({ Type: 'AWS::SNS::Topic' }, 'SharedTopic');
    t.falsy(migration);
});

test('shared API Gateway resource always stays in root stack', t => {
    t.context.plugin.config.perStackName = true;
    t.context.plugin.serverless.service.functions = {
        func1: { stackName: 'group1' },
        func2: { stackName: 'group2' }
    };
    t.context.plugin.serverless.pluginManager.plugins[0].validated.events = [
        { functionName: 'func1', http: { path: '/shared', method: 'GET' } },
        { functionName: 'func2', http: { path: '/shared', method: 'GET' } }
    ];
    const strategy = new PerStackNameStrategy(t.context.plugin);
    const migration = strategy.getDestination({ Type: 'AWS::ApiGateway::Resource' }, '/shared');
    t.falsy(migration);
});

test('custom resource Lambda execution role always stays in root stack', t => {
    t.context.plugin.config.perStackName = true;
    t.context.plugin.serverless.service.functions = {
        func1: { stackName: 'group1' },
        func2: { stackName: 'group2' }
    };
    const strategy = new PerStackNameStrategy(t.context.plugin);

    // Test that the custom resource Lambda execution role stays in root stack
    const migration = strategy.getDestination(
        { Type: 'AWS::IAM::Role' },
        'IamRoleCustomResourcesLambdaExecution'
    );
    t.falsy(migration, 'Custom resource Lambda execution role should stay in root stack');

    // Verify that the role is not assigned to any stack group
    const stackGroups = strategy.getStackGroups();
    const group1Resources = stackGroups['group1'] ? stackGroups['group1'].resources : [];
    const group2Resources = stackGroups['group2'] ? stackGroups['group2'].resources : [];
    t.falsy(group1Resources.includes('IamRoleCustomResourcesLambdaExecution'));
    t.falsy(group2Resources.includes('IamRoleCustomResourcesLambdaExecution'));
}); 