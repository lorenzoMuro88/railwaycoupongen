#!/usr/bin/env node
/**
 * Generate API Documentation from JSDoc
 * 
 * This script extracts JSDoc comments from route files and generates
 * markdown API documentation. It can be run manually or integrated into CI/CD.
 * 
 * Usage:
 *   node scripts/generate-api-docs.js [output-file]
 * 
 * Output file defaults to: docs/API_REFERENCE_GENERATED.md
 */

const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, '..', 'routes');
const ADMIN_ROUTES_DIR = path.join(ROUTES_DIR, 'admin');
const OUTPUT_FILE = process.argv[2] || path.join(__dirname, '..', 'docs', 'API_REFERENCE_GENERATED.md');

/**
 * Extract JSDoc from a file
 */
function extractJSDocComments(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const jsdocRegex = /\/\*\*[\s\S]*?\*\//g;
    const matches = content.match(jsdocRegex) || [];
    
    return matches.map(jsdoc => {
        // Clean up JSDoc
        let cleaned = jsdoc
            .replace(/\/\*\*/g, '')
            .replace(/\*\//g, '')
            .replace(/^\s*\*\s?/gm, '')
            .trim();
        
        return cleaned;
    });
}

/**
 * Parse JSDoc to extract route information
 */
function parseJSDoc(jsdoc) {
    const route = {
        method: null,
        path: null,
        description: '',
        middleware: [],
        params: [],
        returns: null,
        throws: [],
        examples: []
    };
    
    const lines = jsdoc.split('\n');
    let currentSection = 'description';
    let exampleLines = [];
    let inExample = false;
    
    for (const line of lines) {
        const trimmed = line.trim();
        
        // Route tag
        if (trimmed.startsWith('@route')) {
            const match = trimmed.match(/@route\s+(GET|POST|PUT|DELETE|PATCH)\s+(.+)/i);
            if (match) {
                route.method = match[1].toUpperCase();
                route.path = match[2].trim();
            }
        }
        
        // Middleware tag
        else if (trimmed.startsWith('@middleware')) {
            const middlewareStr = trimmed.replace('@middleware', '').trim();
            route.middleware = middlewareStr.split(',').map(m => m.trim()).filter(m => m);
        }
        
        // Param tag
        else if (trimmed.startsWith('@param')) {
            const paramMatch = trimmed.match(/@param\s+\{([^}]+)\}\s+(\[?[\w.]+]?)\s*-\s*(.+)/);
            if (paramMatch) {
                route.params.push({
                    type: paramMatch[1],
                    name: paramMatch[2],
                    description: paramMatch[3] || '',
                    optional: paramMatch[2].startsWith('[')
                });
            }
        }
        
        // Returns tag
        else if (trimmed.startsWith('@returns')) {
            const returnsMatch = trimmed.match(/@returns\s+\{([^}]+)\}\s*(.+)?/);
            if (returnsMatch) {
                route.returns = {
                    type: returnsMatch[1],
                    description: returnsMatch[2] || ''
                };
            }
        }
        
        // Throws tag
        else if (trimmed.startsWith('@throws')) {
            const throwsMatch = trimmed.match(/@throws\s+\{?(\d+)\}?\s*(.+)?/);
            if (throwsMatch) {
                route.throws.push({
                    code: throwsMatch[1],
                    description: throwsMatch[2] || ''
                });
            }
        }
        
        // Example tag
        else if (trimmed.startsWith('@example')) {
            inExample = true;
            exampleLines = [];
        }
        
        // Collect example lines
        else if (inExample) {
            if (trimmed && !trimmed.startsWith('@')) {
                exampleLines.push(trimmed);
            } else if (trimmed.startsWith('@')) {
                inExample = false;
                if (exampleLines.length > 0) {
                    route.examples.push(exampleLines.join('\n'));
                }
                exampleLines = [];
            }
        }
        
        // Description (everything before first @tag)
        else if (!trimmed.startsWith('@') && trimmed && !route.description) {
            route.description = trimmed;
        } else if (!trimmed.startsWith('@') && trimmed && route.description) {
            route.description += ' ' + trimmed;
        }
    }
    
    // Add last example if exists
    if (inExample && exampleLines.length > 0) {
        route.examples.push(exampleLines.join('\n'));
    }
    
    return route;
}

/**
 * Generate markdown for a route
 */
function generateRouteMarkdown(route, fileName) {
    let md = `### ${route.method} ${route.path}\n\n`;
    
    if (route.description) {
        md += `${route.description}\n\n`;
    }
    
    if (route.middleware.length > 0) {
        md += `**Middleware:** ${route.middleware.join(', ')}\n\n`;
    }
    
    if (route.params.length > 0) {
        md += `**Parameters:**\n\n`;
        route.params.forEach(param => {
            const optional = param.optional ? ' (optional)' : '';
            md += `- \`${param.name}\` {${param.type}}${optional} - ${param.description}\n`;
        });
        md += '\n';
    }
    
    if (route.returns) {
        md += `**Returns:** {${route.returns.type}} ${route.returns.description}\n\n`;
    }
    
    if (route.throws.length > 0) {
        md += `**Errors:**\n\n`;
        route.throws.forEach(err => {
            md += `- \`${err.code}\` - ${err.description}\n`;
        });
        md += '\n';
    }
    
    if (route.examples.length > 0) {
        md += `**Example:**\n\n\`\`\`javascript\n${route.examples[0]}\n\`\`\`\n\n`;
    }
    
    md += '---\n\n';
    
    return md;
}

/**
 * Process a route file
 */
function processRouteFile(filePath) {
    const fileName = path.basename(filePath);
    const jsdocs = extractJSDocComments(filePath);
    const routes = [];
    
    for (const jsdoc of jsdocs) {
        const route = parseJSDoc(jsdoc);
        if (route.method && route.path) {
            routes.push(route);
        }
    }
    
    return {
        fileName,
        routes
    };
}

/**
 * Generate complete API documentation
 */
function generateAPIDocumentation() {
    console.log('Generating API documentation from JSDoc...\n');
    
    const sections = [];
    
    // Process admin routes
    const adminFiles = [
        'campaigns.js',
        'users.js',
        'coupons.js',
        'products.js',
        'auth-users.js',
        'settings.js',
        'analytics.js'
    ];
    
    for (const file of adminFiles) {
        const filePath = path.join(ADMIN_ROUTES_DIR, file);
        if (fs.existsSync(filePath)) {
            const result = processRouteFile(filePath);
            if (result.routes.length > 0) {
                sections.push({
                    title: `Admin Routes: ${file.replace('.js', '')}`,
                    routes: result.routes
                });
                console.log(`  ✓ Processed ${file} (${result.routes.length} routes)`);
            }
        }
    }
    
    // Process auth routes
    const authFilePath = path.join(ROUTES_DIR, 'auth.js');
    if (fs.existsSync(authFilePath)) {
        const result = processRouteFile(authFilePath);
        if (result.routes.length > 0) {
            sections.push({
                title: 'Authentication Routes',
                routes: result.routes
            });
            console.log(`  ✓ Processed auth.js (${result.routes.length} routes)`);
        }
    }
    
    // Generate markdown
    let markdown = `# API Reference (Auto-generated from JSDoc)\n\n`;
    markdown += `> **Note:** This file is auto-generated from JSDoc comments in route files.\n`;
    markdown += `> Last generated: ${new Date().toISOString()}\n\n`;
    markdown += `> **Warning:** Do not edit this file manually. Regenerate using: \`npm run docs:generate\`\n\n`;
    markdown += `---\n\n`;
    
    for (const section of sections) {
        markdown += `## ${section.title}\n\n`;
        for (const route of section.routes) {
            markdown += generateRouteMarkdown(route, section.title);
        }
    }
    
    // Write to file
    fs.writeFileSync(OUTPUT_FILE, markdown, 'utf8');
    console.log(`\n✓ Documentation generated: ${OUTPUT_FILE}`);
    console.log(`  Total routes documented: ${sections.reduce((sum, s) => sum + s.routes.length, 0)}`);
}

// Run if called directly
if (require.main === module) {
    try {
        generateAPIDocumentation();
    } catch (err) {
        console.error('Error generating documentation:', err);
        process.exit(1);
    }
}

module.exports = { generateAPIDocumentation };


