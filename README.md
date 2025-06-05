# serverless-plugin-split-stacks-by-group

> This is a fork and imporvment of [dougmoscrop/serverless-plugin-split-stacks](https://github.com/dougmoscrop/serverless-plugin-split-stacks) decided to add some features and improvments as well as maintain a CI for this. Feel free to contribute.

This plugin migrates CloudFormation resources in to nested stacks in order to work around the 500 resource limit.

There are built-in migration strategies that can be turned on or off as well as defining your own custom migrations. It is a good idea to select the best strategy for your needs from the start because the only reliable method of changing strategy later on is to recreate the deployment from scratch. You configure this in your `serverless.yml` (defaults shown):

```yaml
custom:
  splitStacks:
    perFunction: false
    perType: true
    perGroupFunction: false
    perCustomGroup: false  # Default: false. Enables the ByCustomGroup strategy when true
    detailed: true   # Show detailed resource information (default: true)
    verbose: false   # Show detailed reference information (default: false)
    plan: false      # Print summary and exit without deploying (default: false)
    analyze: false   # Generate detailed stack analysis file (default: false)
```

## Migration Strategies

### By Custom Group (perCustomGroup)

This splits resources off into nested stacks based on the `stackName` property in your Lambda function definitions. Functions with the same `stackName` will be deployed into the same stack. This is useful when you want to explicitly control which functions are grouped together.

Example configuration:
```yaml
custom:
  splitStacks:
    perCustomGroup: true  # Enable the ByCustomGroup strategy

functions:
  function1:
    handler: handler.function1
    stackName: group1
  function2:
    handler: handler.function2
    stackName: group1
  function3:
    handler: handler.function3
    stackName: group2
```

In this example, `function1` and `function2` will be deployed in the same stack because they share the same `stackName`, while `function3` will be in a different stack.

### Per Lambda

This splits resources off in to a nested stack dedicated to the associated Lambda function. This defaults to off in 1.x but will switch to enabled by default in 2.x

### Per Type

This moves resources in to a nested stack for the given resource type. If `Per Lambda` is enabled, it takes precedence over `Per Type`.

### Per Lambda Group

This splits resources off in to a nested stack dedicated to a set of Lambda functions and associated resources. If `Per Lambda` or `Per Type` is enabled, it takes precedence over `Per Lambda Group`. In order to control the number of nested stacks, following configurations are needed:

```yaml
custom:
  splitStacks:
    nestedStackCount: 20 # Controls the number of created nested stacks
    perFunction: false
    perType: false
    perGroupFunction: true
```

Once set, the `nestedStackCount` configuration should never be changed because the only reliable method of changing it later on is to recreate the deployment from scratch.

## Concurrency

In order to avoid `API rate limit` errors, it is possible to configure the plugin in 2 different ways:
 * Set nested stacks to depend on each others.
 * Set resources in the nested stack to depend on each others.

This feature comes with a 2 new configurations, `stackConcurrency` and `resourceConcurrency` :


```yaml
custom:
  splitStacks:
    perFunction: true
    perType: false
    perGroupFunction: false
    stackConcurrency: 5 # Controls if enabled and how much stacks are deployed in parallel. Disabled if absent.
    resourceConcurrency: 10 # Controls how much resources are deployed in parallel. Disabled if absent.
```

## Limitations

This plugin is not a substitute for fine-grained services - try to limit the size of your service. This plugin has a hard limit of 200 sub-stacks and does not try to create any kind of tree of nested stacks.

## Advanced Usage

If you create a file in the root of your Serverless project called `stacks-map.js` this plugin will load it.

This file can customize migrations, either by exporting a simple map of resource type to migration, or a function that can have whatever logic you want.

```javascript
module.exports = {
  'AWS::DynamoDB::Table': { destination: 'Dynamodb' }
}
```

```javascript
module.exports = (resource, logicalId) => {
  if (logicalId.startsWith("Foo")) return { destination: 'Foo' };

  // Falls back to default
};
```

You can also point to your custom splitter from the `custom` block in your serverless file:
```
custom:
  splitStacks:
    custom: path/to/your/splitter.js
```

__Be careful when introducing any customizations to default config. Many kind of resources (as e.g. DynamoDB tables) cannot be freely moved between CloudFormation stacks (that can only be achieved via full removal and recreation of the stage)__

### Force Migration

Custom migrations can specify `{ force: true }` to force the migration of an existing resource in to a new stack. BE CAREFUL. This will cause a resource to be deleted and recreated. It may not even work if CloudFormation tries to create the new one before deleting the old one and they have a name or some other unique property that cannot have two resources existing at the same time. It can also mean a small window of downtime during this period, for example as an `AWS::Lambda::Permission` is deleted/recreated calls may be denied until IAM sorts things out.

## Proxy Support

This plugin makes use of the `proxy-agent` library, which reads environmental varaibles for configuration. To avoid conflicts with existing deployments, it is not used automatically, but instead needs to be enabled via serverless config:

```yml
custom:
  splitStacks:
    proxyAgent: true
```

## Analysis Feature

When `analyze: true` is set, the plugin generates a comprehensive analysis of your stack structure in `.serverless/stack-analysis-{timestamp}.json` and `.serverless/stack-analysis-{timestamp}-summary.md`. This analysis includes:

- Complete resource inventory for each stack
- Cross-stack reference mapping
- Dependency hierarchy visualization
- Potential circular dependency warnings
- Optimization suggestions (underutilized stacks, stacks approaching limits)

Example analysis output structure:
```json
{
  "summary": {
    "totalStacks": 5,
    "totalResources": 245,
    "potentialIssues": [{
      "type": "circular_dependency_risk",
      "severity": "warning",
      "description": "Mutual references between stacks"
    }]
  },
  "stacks": {
    "stack-user-service": {
      "resourceCount": 67,
      "resources": { /* detailed resource info */ }
    }
  },
  "dependencyGraph": { /* stack dependency levels */ }
}
```

This analysis file can be used with LLMs or other tools to quickly identify and resolve circular dependencies or optimization opportunities.

## Development Tips

### Testing the Plugin Locally

To test changes to the plugin in your serverless project:

1. Build the plugin:
```bash
cd /path/to/serverless-plugin-split-stacks-by-group
npm pack
```

2. Install the local version in your project:
```bash
cd /path/to/your/serverless/project
npm remove serverless-plugin-split-stacks-by-group
npm install /path/to/serverless-plugin-split-stacks-by-group/serverless-plugin-split-stacks-by-group-1.1.0.tgz
```

3. Deploy your serverless project:
```bash
npx sls deploy
```

### Best Practices

1. Always test changes in a development environment first
2. Use the `plan` option to preview changes without deploying:
```yaml
custom:
  splitStacks:
    plan: true
```

3. Enable the analysis feature to understand your stack structure:
```yaml
custom:
  splitStacks:
    analyze: true
```

4. Use the `verbose` option during development for detailed reference information:
```yaml
custom:
  splitStacks:
    verbose: true
```

### Debugging

If you encounter issues:

1. Check the generated stack analysis files in `.serverless/stack-analysis-{timestamp}.json`
2. Enable verbose logging to see detailed reference information
3. Use the plan mode to preview changes before deployment
4. Review the CloudFormation console for detailed error messages


# TODOs

1. If a group grows bigger than 500 resources, create a new nested stack for the custom group
2. environment variables for some of the options to be enabled
3. better ci/automation