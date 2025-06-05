'use strict';

const test = require('ava');
const sinon = require('sinon');
const fs = require('fs');
const analyzeStacks = require('../../lib/analyze-stacks');

test.beforeEach(t => {
    const plugin = {
        config: {
            analyze: true
        },
        serverless: {
            config: {
                servicePath: '/tmp/test-service'
            },
            service: {
                functions: {
                    func1: { stackName: 'group1' },
                    func2: { stackName: 'group2' }
                }
            }
        },
        rootTemplate: {
            Resources: {
                ApiGatewayRestApi: { Type: 'AWS::ApiGateway::RestApi' },
                ServerlessDeploymentBucket: { Type: 'AWS::S3::Bucket' }
            }
        },
        nestedStacks: {
            'stack-group1': {
                Resources: {
                    Func1LambdaFunction: {
                        Type: 'AWS::Lambda::Function',
                        Properties: {
                            Environment: {
                                Variables: {
                                    TABLE_NAME: { Ref: 'SharedTable' }
                                }
                            }
                        }
                    },
                    Func1LogGroup: { Type: 'AWS::Logs::LogGroup' }
                }
            },
            'shared': {
                Resources: {
                    SharedTable: { Type: 'AWS::DynamoDB::Table' }
                }
            }
        },
        log: sinon.spy()
    };

    t.context = { plugin };
});

test.serial('does not analyze when analyze is false', t => {
    const writeFileSyncStub = sinon.stub(fs, 'writeFileSync');

    try {
        t.context.plugin.config.analyze = false;

        analyzeStacks.call(t.context.plugin);

        t.false(writeFileSyncStub.called);
    } finally {
        writeFileSyncStub.restore();
    }
});

test.serial('generates analysis files when analyze is true', t => {
    const writeFileSyncStub = sinon.stub(fs, 'writeFileSync');
    const existsSyncStub = sinon.stub(fs, 'existsSync').returns(true);

    try {
        analyzeStacks.call(t.context.plugin);

        t.true(writeFileSyncStub.calledTwice);

        // Check JSON file was written
        const jsonCall = writeFileSyncStub.firstCall;
        t.regex(jsonCall.args[0], /stack-analysis-\d+\.json$/);

        const analysis = JSON.parse(jsonCall.args[1]);
        t.truthy(analysis.timestamp);
        t.truthy(analysis.summary);
        t.truthy(analysis.stacks);

        // Check markdown summary was written
        const mdCall = writeFileSyncStub.secondCall;
        t.regex(mdCall.args[0], /stack-analysis-\d+-summary\.md$/);
    } finally {
        writeFileSyncStub.restore();
        existsSyncStub.restore();
    }
});

test.serial('correctly identifies stack types', t => {
    const writeFileSyncStub = sinon.stub(fs, 'writeFileSync');
    const existsSyncStub = sinon.stub(fs, 'existsSync').returns(true);

    try {
        analyzeStacks.call(t.context.plugin);

        const jsonCall = writeFileSyncStub.firstCall;
        const analysis = JSON.parse(jsonCall.args[1]);

        t.is(analysis.stacks.root.type, 'root');
        t.is(analysis.stacks['stack-group1'].type, 'byCustomGroup');
        t.is(analysis.stacks.shared.type, 'shared');
    } finally {
        writeFileSyncStub.restore();
        existsSyncStub.restore();
    }
});

test.serial('tracks cross-stack references', t => {
    const writeFileSyncStub = sinon.stub(fs, 'writeFileSync');
    const existsSyncStub = sinon.stub(fs, 'existsSync').returns(true);

    try {
        analyzeStacks.call(t.context.plugin);

        const jsonCall = writeFileSyncStub.firstCall;
        const analysis = JSON.parse(jsonCall.args[1]);

        // Should detect reference from Func1LambdaFunction to SharedTable
        const func1Resource = analysis.stacks['stack-group1'].resources.Func1LambdaFunction;
        t.true(func1Resource.references.includes('SharedTable'));

        // Check cross-stack references
        const crossStackRef = analysis.referenceMap.crossStackReferences.find(
            ref => ref.from === 'stack-group1/Func1LambdaFunction' &&
                ref.to === 'shared/SharedTable'
        );
        t.truthy(crossStackRef);
    } finally {
        writeFileSyncStub.restore();
        existsSyncStub.restore();
    }
});

test.serial('generates resource distribution summary', t => {
    const writeFileSyncStub = sinon.stub(fs, 'writeFileSync');
    const existsSyncStub = sinon.stub(fs, 'existsSync').returns(true);

    try {
        analyzeStacks.call(t.context.plugin);

        const jsonCall = writeFileSyncStub.firstCall;
        const analysis = JSON.parse(jsonCall.args[1]);

        t.is(analysis.summary.resourceDistribution.root, 2);
        t.is(analysis.summary.resourceDistribution['stack-group1'], 2);
        t.is(analysis.summary.resourceDistribution.shared, 1);
        t.is(analysis.summary.totalResources, 5);
    } finally {
        writeFileSyncStub.restore();
        existsSyncStub.restore();
    }
});

test.serial('creates directory if it does not exist', t => {
    const writeFileSyncStub = sinon.stub(fs, 'writeFileSync');
    const existsSyncStub = sinon.stub(fs, 'existsSync').returns(false);
    const mkdirSyncStub = sinon.stub(fs, 'mkdirSync');

    try {
        analyzeStacks.call(t.context.plugin);

        t.true(mkdirSyncStub.called);
        t.deepEqual(mkdirSyncStub.firstCall.args[1], { recursive: true });
    } finally {
        writeFileSyncStub.restore();
        existsSyncStub.restore();
        mkdirSyncStub.restore();
    }
});

test.serial('logs output file location', t => {
    const writeFileSyncStub = sinon.stub(fs, 'writeFileSync');
    const existsSyncStub = sinon.stub(fs, 'existsSync').returns(true);

    try {
        analyzeStacks.call(t.context.plugin);

        t.true(t.context.plugin.log.called);
        const logMessage = t.context.plugin.log.firstCall.args[0];
        t.regex(logMessage, /Stack analysis written to/);
    } finally {
        writeFileSyncStub.restore();
        existsSyncStub.restore();
    }
}); 