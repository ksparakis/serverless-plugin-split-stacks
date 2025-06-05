'use strict';

const fs = require('fs');
const path = require('path');

module.exports = function analyzeStacks() {
    if (!this.config.analyze) {
        return;
    }

    const analysis = {
        timestamp: new Date().toISOString(),
        summary: {
            totalStacks: 0,
            totalResources: 0,
            totalReferences: 0,
            resourceDistribution: {},
            potentialIssues: []
        },
        stacks: {},
        referenceMap: {
            byResource: {},
            crossStackReferences: []
        },
        dependencyGraph: {
            layers: {}
        },
        potentialOptimizations: []
    };

    // Analyze root stack
    const rootResources = this.rootTemplate.Resources || {};
    analysis.stacks.root = {
        type: 'root',
        resourceCount: Object.keys(rootResources).length,
        resources: {}
    };
    analysis.summary.resourceDistribution.root = Object.keys(rootResources).length;

    // Analyze each resource in root
    Object.entries(rootResources).forEach(([logicalId, resource]) => {
        const references = findAllReferences.call(this, resource);
        analysis.stacks.root.resources[logicalId] = {
            type: resource.Type,
            referencedBy: [],
            references: references.map(ref => ref.targetId)
        };
    });

    // Analyze nested stacks
    if (this.nestedStacks) {
        Object.entries(this.nestedStacks).forEach(([stackName, stack]) => {
            if (!stack || !stack.Resources) return;

            const resources = stack.Resources;
            const resourceCount = Object.keys(resources).length;

            analysis.summary.totalStacks++;
            analysis.summary.resourceDistribution[stackName] = resourceCount;

            // Determine stack type
            let stackType = 'custom';
            let stackGroupName = null;
            if (stackName === 'shared') {
                stackType = 'shared';
            } else if (stackName.startsWith('stack-')) {
                stackType = 'byCustomGroup';
                stackGroupName = stackName.replace(/^stack-/, '').replace(/-\d+$/, '');
            }

            analysis.stacks[stackName] = {
                type: stackType,
                resourceCount: resourceCount,
                resources: {}
            };

            if (stackGroupName) {
                analysis.stacks[stackName].stackName = stackGroupName;

                // Find functions in this stack
                const functions = [];
                Object.entries(this.serverless.service.functions || {}).forEach(([funcName, funcDef]) => {
                    if (funcDef.stackName === stackGroupName) {
                        functions.push(funcName);
                    }
                });
                if (functions.length > 0) {
                    analysis.stacks[stackName].functions = functions;
                }
            }

            // Analyze resources in the stack
            Object.entries(resources).forEach(([logicalId, resource]) => {
                const references = findAllReferences.call(this, resource);
                analysis.stacks[stackName].resources[logicalId] = {
                    type: resource.Type,
                    referencedBy: [],
                    references: references.map(ref => ref.targetId),
                    crossStackReferences: []
                };

                // Track cross-stack references
                references.forEach(ref => {
                    const targetStack = findResourceStack.call(this, ref.targetId);
                    if (targetStack && targetStack !== stackName) {
                        analysis.stacks[stackName].resources[logicalId].crossStackReferences.push({
                            targetStack: targetStack,
                            targetResource: ref.targetId,
                            referenceType: ref.type
                        });

                        analysis.referenceMap.crossStackReferences.push({
                            from: `${stackName}/${logicalId}`,
                            to: `${targetStack}/${ref.targetId}`,
                            type: ref.type
                        });
                    }
                });
            });
        });
    }

    // Build reference map
    buildReferenceMap.call(this, analysis);

    // Calculate totals
    analysis.summary.totalResources = Object.values(analysis.summary.resourceDistribution)
        .reduce((sum, count) => sum + count, 0);
    analysis.summary.totalReferences = analysis.referenceMap.crossStackReferences.length;

    // Analyze for potential issues
    detectPotentialIssues.call(this, analysis);

    // Build dependency graph
    buildDependencyGraph.call(this, analysis);

    // Find optimization opportunities
    findOptimizations.call(this, analysis);

    // Write analysis to file
    const outputPath = path.join(
        this.serverless.config.servicePath,
        `.serverless/stack-analysis-${Date.now()}.json`
    );

    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(analysis, null, 2));

    this.log(`[serverless-plugin-split-stacks-by-group]: Stack analysis written to ${outputPath}`);

    // Also create a human-readable summary
    createReadableSummary.call(this, analysis, outputPath.replace('.json', '-summary.md'));
};

// Helper function to find all references in a resource
function findAllReferences(resource) {
    const references = [];

    const search = (obj, path = '') => {
        if (!obj || typeof obj !== 'object') return;

        // Check for Ref
        if (obj.Ref) {
            references.push({
                type: 'Ref',
                targetId: obj.Ref,
                path: path
            });
        }

        // Check for GetAtt
        if (obj['Fn::GetAtt'] && Array.isArray(obj['Fn::GetAtt'])) {
            references.push({
                type: 'GetAtt',
                targetId: obj['Fn::GetAtt'][0],
                attribute: obj['Fn::GetAtt'][1],
                path: path
            });
        }

        // Check for Sub
        if (obj['Fn::Sub']) {
            const template = typeof obj['Fn::Sub'] === 'string'
                ? obj['Fn::Sub']
                : obj['Fn::Sub'][0];

            // Extract references from Sub template
            const matches = template.match(/\${([^}]+)}/g) || [];
            matches.forEach(match => {
                const ref = match.slice(2, -1);
                if (!ref.includes('.')) {
                    references.push({
                        type: 'Sub',
                        targetId: ref,
                        path: path
                    });
                }
            });
        }

        // Recurse
        Object.entries(obj).forEach(([key, value]) => {
            search(value, path ? `${path}.${key}` : key);
        });
    };

    search(resource);
    return references;
}

// Find which stack a resource belongs to
function findResourceStack(resourceId) {
    // Check root stack
    if (this.rootTemplate.Resources && this.rootTemplate.Resources[resourceId]) {
        return 'root';
    }

    // Check nested stacks
    if (this.nestedStacks) {
        for (const [stackName, stack] of Object.entries(this.nestedStacks)) {
            if (stack && stack.Resources && stack.Resources[resourceId]) {
                return stackName;
            }
        }
    }

    return null;
}

// Build complete reference map
function buildReferenceMap(analysis) {
    Object.entries(analysis.stacks).forEach(([stackName, stack]) => {
        Object.entries(stack.resources).forEach(([resourceId, resource]) => {
            // Initialize reference tracking for this resource
            if (!analysis.referenceMap.byResource[resourceId]) {
                analysis.referenceMap.byResource[resourceId] = {
                    referencedBy: []
                };
            }

            // Track who references this resource
            resource.references.forEach(targetId => {
                if (!analysis.referenceMap.byResource[targetId]) {
                    analysis.referenceMap.byResource[targetId] = {
                        referencedBy: []
                    };
                }

                analysis.referenceMap.byResource[targetId].referencedBy.push({
                    stack: stackName,
                    resource: resourceId,
                    type: 'Ref' // This should be more specific based on actual reference type
                });
            });
        });
    });
}

// Detect potential issues
function detectPotentialIssues(analysis) {
    // Check for potential circular dependencies
    const stackReferences = {};

    analysis.referenceMap.crossStackReferences.forEach(ref => {
        const fromStack = ref.from.split('/')[0];
        const toStack = ref.to.split('/')[0];

        if (!stackReferences[fromStack]) {
            stackReferences[fromStack] = new Set();
        }
        stackReferences[fromStack].add(toStack);
    });

    // Look for circular patterns
    Object.entries(stackReferences).forEach(([stack, references]) => {
        references.forEach(referencedStack => {
            if (stackReferences[referencedStack] &&
                stackReferences[referencedStack].has(stack)) {
                analysis.summary.potentialIssues.push({
                    type: 'circular_dependency_risk',
                    severity: 'warning',
                    description: `Mutual references between '${stack}' and '${referencedStack}'`,
                    stacks: [stack, referencedStack]
                });
            }
        });
    });

    // Check for shared resources referenced by many stacks
    Object.entries(analysis.referenceMap.byResource).forEach(([resourceId, info]) => {
        const uniqueStacks = new Set(info.referencedBy.map(ref => ref.stack));
        if (uniqueStacks.size > 3) {
            analysis.summary.potentialIssues.push({
                type: 'highly_shared_resource',
                severity: 'info',
                description: `Resource '${resourceId}' is referenced by ${uniqueStacks.size} different stacks`,
                resource: resourceId,
                stacks: Array.from(uniqueStacks)
            });
        }
    });
}

// Build dependency graph
function buildDependencyGraph(analysis) {
    // Initialize all stacks
    Object.keys(analysis.stacks).forEach(stackName => {
        analysis.dependencyGraph.layers[stackName] = {
            level: -1,
            dependsOn: [],
            dependedOnBy: []
        };
    });

    // Build dependency relationships
    analysis.referenceMap.crossStackReferences.forEach(ref => {
        const fromStack = ref.from.split('/')[0];
        const toStack = ref.to.split('/')[0];

        if (!analysis.dependencyGraph.layers[fromStack].dependsOn.includes(toStack)) {
            analysis.dependencyGraph.layers[fromStack].dependsOn.push(toStack);
        }

        if (!analysis.dependencyGraph.layers[toStack].dependedOnBy.includes(fromStack)) {
            analysis.dependencyGraph.layers[toStack].dependedOnBy.push(fromStack);
        }
    });

    // Assign levels
    analysis.dependencyGraph.layers.root.level = 0;

    let changed = true;
    while (changed) {
        changed = false;
        Object.entries(analysis.dependencyGraph.layers).forEach(([stackName, layer]) => {
            if (layer.level === -1) {
                const dependencyLevels = layer.dependsOn
                    .map(dep => analysis.dependencyGraph.layers[dep].level)
                    .filter(level => level !== -1);

                if (dependencyLevels.length === layer.dependsOn.length) {
                    layer.level = Math.max(...dependencyLevels) + 1;
                    changed = true;
                }
            }
        });
    }
}

// Find optimization opportunities
function findOptimizations(analysis) {
    Object.entries(analysis.stacks).forEach(([stackName, stack]) => {
        // Check for underutilized stacks
        if (stack.resourceCount < 20 && stack.type !== 'root' && stack.type !== 'shared') {
            analysis.potentialOptimizations.push({
                type: 'underutilized_stack',
                stack: stackName,
                resourceCount: stack.resourceCount,
                suggestion: 'Consider merging with another small stack to reduce overhead'
            });
        }

        // Check for stacks approaching limits
        if (stack.resourceCount > 450) {
            analysis.potentialOptimizations.push({
                type: 'large_stack',
                stack: stackName,
                resourceCount: stack.resourceCount,
                suggestion: 'Stack approaching AWS limit (500), consider splitting'
            });
        }
    });
}

// Create human-readable summary
function createReadableSummary(analysis, outputPath) {
    let summary = '# Stack Analysis Summary\n\n';
    summary += `Generated: ${analysis.timestamp}\n\n`;

    summary += '## Overview\n';
    summary += `- Total Stacks: ${analysis.summary.totalStacks}\n`;
    summary += `- Total Resources: ${analysis.summary.totalResources}\n`;
    summary += `- Cross-Stack References: ${analysis.summary.totalReferences}\n\n`;

    summary += '## Stack Distribution\n';
    Object.entries(analysis.summary.resourceDistribution).forEach(([stack, count]) => {
        summary += `- ${stack}: ${count} resources\n`;
    });

    if (analysis.summary.potentialIssues.length > 0) {
        summary += '\n## Potential Issues\n';
        analysis.summary.potentialIssues.forEach(issue => {
            summary += `- **${issue.severity.toUpperCase()}**: ${issue.description}\n`;
        });
    }

    if (analysis.potentialOptimizations.length > 0) {
        summary += '\n## Optimization Opportunities\n';
        analysis.potentialOptimizations.forEach(opt => {
            summary += `- ${opt.suggestion} (${opt.stack}: ${opt.resourceCount} resources)\n`;
        });
    }

    summary += '\n## Dependency Hierarchy\n';
    const sortedStacks = Object.entries(analysis.dependencyGraph.layers)
        .sort((a, b) => a[1].level - b[1].level);

    sortedStacks.forEach(([stack, info]) => {
        summary += `- Level ${info.level}: ${stack}`;
        if (info.dependsOn.length > 0) {
            summary += ` (depends on: ${info.dependsOn.join(', ')})`;
        }
        summary += '\n';
    });

    fs.writeFileSync(outputPath, summary);
} 