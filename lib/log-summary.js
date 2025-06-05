"use strict";

function printStackInfo(stack, stackName) {
  if (!stack) {
    this.log(`└─ ${stackName || '(root)'}: No resources`);
    return;
  }

  const outputs = stack.Outputs || [];
  const resources = stack.Resources || {};
  const parameters = stack.Parameters || {};
  const references = this.getReferencedResources(resources);

  // Calculate totals
  const totalResources = Object.keys(resources).length;
  const totalParameters = Object.keys(parameters).length;
  const totalOutputs = outputs.length;
  const totalReferences = references.length;

  // Print stack header with reference count
  this.log(`└─ ${stackName || '(root)'}: ${totalResources} resources${totalReferences > 0 ? `, ${totalReferences} references` : ''}`);

  // Print Parameters section if detailed or verbose
  if (totalParameters > 0 && (this.config.detailed || this.config.verbose)) {
    this.log(`   ├─ Parameters (${totalParameters}):`);
    Object.entries(parameters).forEach(([name, param]) => {
      const type = param.Type || 'String';
      const defaultValue = param.Default ? ` = ${param.Default}` : '';
      this.log(`   │  ├─ ${name}: ${type}${defaultValue}`);
    });
  }

  // Print Outputs section if detailed or verbose
  if (totalOutputs > 0 && (this.config.detailed || this.config.verbose)) {
    this.log(`   ├─ Outputs (${totalOutputs}):`);
    outputs.forEach(output => {
      const description = output.Description ? ` - ${output.Description}` : '';
      this.log(`   │  ├─ ${output.OutputKey}${description}`);
    });
  }

  // Print Resources section if detailed or verbose
  if (totalResources > 0 && (this.config.detailed || this.config.verbose)) {
    this.log(`   ├─ Resources (${totalResources}):`);
    Object.entries(resources).forEach(([name, resource]) => {
      this.log(`   │  ├─ ${name}: ${resource.Type}`);
    });
  }

  // Print References section only if verbose
  if (totalReferences > 0 && this.config.verbose) {
    this.log(`   └─ References (${totalReferences}):`);

    // Group references by resource
    const refsByResource = {};
    references.forEach(ref => {
      if (!refsByResource[ref.id]) {
        refsByResource[ref.id] = [];
      }
      refsByResource[ref.id].push(ref);
    });

    Object.entries(refsByResource).forEach(([resourceId, refs]) => {
      const resource = resources[resourceId];
      const resourceType = resource ? resource.Type : 'Unknown';
      this.log(`      ├─ ${resourceId} (${resourceType}) references:`);

      refs.forEach(ref => {
        let refStr = '';
        if (ref.value.Ref) {
          refStr = `Ref(${ref.value.Ref})`;
        } else if (ref.value['Fn::GetAtt']) {
          refStr = `GetAtt(${ref.value['Fn::GetAtt'][0]}, ${ref.value['Fn::GetAtt'][1]})`;
        } else if (ref.value['Fn::Join']) {
          refStr = 'Join(...)';
        } else if (ref.value['Fn::Sub']) {
          refStr = 'Sub(...)';
        } else {
          refStr = JSON.stringify(ref.value);
        }
        this.log(`      │  └─ ${ref.id}: ${refStr}`);
      });
    });
  }
}

module.exports = function logSummary() {
  if (this.nestedStacks) {
    const before = Object.keys(this.resourcesById).length;
    const after = Object.keys(this.rootTemplate.Resources).length;
    const stacks = Object.values(this.nestedStacks).filter(
      (stack) => stack && Object.keys(stack.Resources || {}).length > 0
    ).length;

    // Get stack groups from byCustomGroup strategy if it exists
    const byCustomGroupStrategy = this.migrationStrategies && this.migrationStrategies.find(strategy => strategy.constructor.name === 'ByCustomGroup');
    const stackGroups = byCustomGroupStrategy && byCustomGroupStrategy.getStackGroups() || {};

    // Calculate total resources migrated
    const totalResourcesMigrated = stacks + before - after;

    // Get active strategies
    const activeStrategies = [];
    if (this.config.perType) activeStrategies.push('perType');
    if (this.config.perFunction) activeStrategies.push('perFunction');
    if (this.config.perCustomGroup) activeStrategies.push('byCustomGroup');
    if (this.config.custom) activeStrategies.push('custom');

    this.log(
      `[serverless-plugin-split-stacks-by-group]: Using strategies: ${activeStrategies.join(', ')}`
    );
    this.log(
      `[serverless-plugin-split-stacks-by-group]: Summary: ${totalResourcesMigrated} resources migrated into ${stacks} nested stacks`
    );

    // Print root stack info
    printStackInfo.call(this, this.rootTemplate, null);

    // Print stack groups first if they exist
    if (Object.keys(stackGroups).length > 0) {
      Object.keys(stackGroups).forEach((stackName) => {
        const stack = this.nestedStacks[`stack-${stackName}`];
        if (stack) {
          printStackInfo.call(this, stack, `stack-${stackName}`);
        }
      });
    }

    // Print remaining stacks
    Object.keys(this.nestedStacks)
      .filter(name => !name.startsWith('stack-')) // Skip stack groups as they're already printed
      .sort()
      .forEach((name) => {
        const stack = this.nestedStacks[name];
        if (stack) {
          printStackInfo.call(this, stack, name);
        }
      });
  }
};
