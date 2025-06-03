"use strict";

function printStackInfo(stackName, isLast = false) {
  const {
    Outputs = {},
    Resources = {},
    Parameters = {},
  } = stackName ? this.nestedStacks[stackName] : this.rootTemplate;
  const outputs = Object.keys(Outputs).length;
  const parameters = Object.keys(Parameters).length;
  const resources = Object.keys(Resources).length;
  const references = Object.values(Resources).reduce(
    (acc, res) => this.getReferencedResources(res).length + acc,
    0
  );

  this.log(`${isLast ? "└" : "├"}─ ${stackName || "(root)"}: ${resources}`);
  this.log(`${isLast ? " " : "│"}  ├─ Outputs: ${outputs}`);
  this.log(
    `${isLast ? " " : "│"
    }  └─ Parameters: ${parameters} (References: ${references})`
  );
}

module.exports = function logSummary() {
  if (this.nestedStacks) {
    const before = Object.keys(this.resourcesById).length;
    const after = Object.keys(this.rootTemplate.Resources).length;
    const stacks = Object.values(this.nestedStacks).filter(
      (stack) => Object.keys(stack.Resources).length > 0
    ).length;

    // Get stack groups from perStackName strategy if it exists
    const perStackNameStrategy = this.migrationStrategies?.find(strategy => strategy.constructor.name === 'PerStackNameStrategy');
    const stackGroups = perStackNameStrategy?.getStackGroups() || {};

    // Calculate total resources migrated
    const totalResourcesMigrated = stacks + before - after;

    this.log(
      `Summary: ${totalResourcesMigrated} resources migrated into ${stacks} nested stacks`
    );
    printStackInfo.call(this, null);

    // Print stack groups first if they exist
    if (Object.keys(stackGroups).length > 0) {
      Object.keys(stackGroups).forEach((stackName, i, arr) => {
        const stack = this.nestedStacks[`stack-${stackName}`];
        if (stack) {
          printStackInfo.call(this, `stack-${stackName}`, i >= arr.length - 1);
        }
      });
    }

    // Print remaining stacks
    Object.keys(this.nestedStacks)
      .filter(name => !name.startsWith('stack-')) // Skip stack groups as they're already printed
      .sort()
      .forEach((name, i, arr) => {
        printStackInfo.call(this, name, i >= arr.length - 1);
      });
  }
};
