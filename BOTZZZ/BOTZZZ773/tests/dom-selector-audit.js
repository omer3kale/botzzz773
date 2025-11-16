#!/usr/bin/env node

/**
 * DOM Selector Audit Script
 * Scans all JS/HTML files for document.getElementById() usage and confirms
 * every referenced ID exists in the markup/template strings across the workspace.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.vscode',
  'netlify',
  'supabase',
  'tests/node_modules'
]);

const SUPPORTED_EXTENSIONS = new Set(['.html', '.js', '.css']);
const ID_DEFINITION_REGEX = /id\s*=\s*(["'`])([^"'`]+)\1/g;
const CLASS_DEFINITION_REGEX = /class\s*=\s*(["'`])([^"'`]+)\1/g;
const CSS_CLASS_REGEX = /(^|[^a-zA-Z0-9_-])\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g;
const DATA_ATTR_VALUE_REGEX = /data-([a-z0-9-]+)\s*=\s*(["'`])[^"'`]*\2/gi;
const DATA_ATTR_BOOLEAN_REGEX = /(?:^|[\s<])data-([a-z0-9-]+)(?=[\s>])/gi;
const CSS_DATA_ATTR_REGEX = /\[data-([a-z0-9-]+)/gi;
const GET_BY_ID_REGEX = /getElementById\s*\(\s*(["'`])([^"'`]+)\1\s*\)/g;
const CLASSLIST_REGEX = /classList\.(?:add|remove|toggle|contains)\s*\(\s*(["'`])([^"'`]+)\1/g;
const QUERY_SELECTOR_REGEX = /querySelector(All)?\s*\(\s*(["'`])([^"'`]+)\2\s*\)/g;
const DATASET_REGEX = /dataset\.([a-zA-Z0-9_]+)/g;
const DATASET_WRITE_REGEX = /dataset\.([a-zA-Z0-9_]+)\s*=/g;
const DATA_ATTR_ACCESS_REGEX = /(getAttribute|setAttribute|hasAttribute)\s*\(\s*(["'`])(data-[^"'`]+)\2/g;

const idDefinitions = new Map(); // id -> Set(files)
const idReferences = new Map(); // id -> Set(files)
const classDefinitions = new Map(); // class -> Set(files)
const classReferences = new Map(); // class -> Set(files)
const dataDefinitions = new Map(); // data attr -> Set(files)
const dataReferences = new Map(); // data attr -> Set(files)

function record(map, key, filePath) {
  if (!map.has(key)) {
    map.set(key, new Set());
  }
  map.get(key).add(path.relative(ROOT_DIR, filePath));
}

function walk(dir, visitor) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, visitor);
    } else {
      visitor(fullPath);
    }
  }
}

function analyzeFile(filePath) {
  const ext = path.extname(filePath);
  if (!SUPPORTED_EXTENSIONS.has(ext)) return;

  const content = fs.readFileSync(filePath, 'utf-8');
  let match;

  if (ext === '.css') {
    while ((match = CSS_CLASS_REGEX.exec(content)) !== null) {
      const cls = match[2];
      record(classDefinitions, cls, filePath);
    }

    while ((match = CSS_DATA_ATTR_REGEX.exec(content)) !== null) {
      const attr = `data-${match[1].toLowerCase()}`;
      record(dataDefinitions, attr, filePath);
    }
    return;
  }

  while ((match = ID_DEFINITION_REGEX.exec(content)) !== null) {
    const idName = match[2];
    record(idDefinitions, idName, filePath);
  }

  while ((match = CLASS_DEFINITION_REGEX.exec(content)) !== null) {
    const classes = match[2].split(/\s+/).filter(Boolean);
    classes.forEach(cls => record(classDefinitions, cls, filePath));
  }

  while ((match = DATA_ATTR_VALUE_REGEX.exec(content)) !== null) {
    const attr = `data-${match[1].toLowerCase()}`;
    record(dataDefinitions, attr, filePath);
  }

  while ((match = DATA_ATTR_BOOLEAN_REGEX.exec(content)) !== null) {
    const attr = `data-${match[1].toLowerCase()}`;
    record(dataDefinitions, attr, filePath);
  }

  if (ext === '.js') {
    while ((match = GET_BY_ID_REGEX.exec(content)) !== null) {
      const idName = match[2];
      record(idReferences, idName, filePath);
    }

    while ((match = CLASSLIST_REGEX.exec(content)) !== null) {
      match[2]
        .split(/\s+/)
        .filter(Boolean)
        .forEach(cls => record(classReferences, cls, filePath));
    }

    while ((match = QUERY_SELECTOR_REGEX.exec(content)) !== null) {
      const selector = match[3];
      const classMatches = selector.match(/\.([a-zA-Z0-9_-]+)/g) || [];
      classMatches.forEach(raw => record(classReferences, raw.slice(1), filePath));

      const dataMatches = selector.match(/\[data-([a-z0-9_-]+)/gi) || [];
      dataMatches.forEach(raw => {
        const attr = raw
          .replace(/^[\[]/, '')
          .replace(/=.*$/, '')
          .toLowerCase();
        record(dataReferences, attr, filePath);
      });
    }

    while ((match = DATASET_WRITE_REGEX.exec(content)) !== null) {
      const attr = `data-${match[1]
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/_/g, '-')
        .toLowerCase()}`;
      record(dataDefinitions, attr, filePath);
      record(dataReferences, attr, filePath);
    }

    while ((match = DATASET_REGEX.exec(content)) !== null) {
      const attr = `data-${match[1]
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/_/g, '-')
        .toLowerCase()}`;
      record(dataReferences, attr, filePath);
    }

    while ((match = DATA_ATTR_ACCESS_REGEX.exec(content)) !== null) {
      const attrName = match[3].toLowerCase();
      record(dataReferences, attrName, filePath);
      if (match[1] === 'setAttribute') {
        record(dataDefinitions, attrName, filePath);
      }
    }
  }
}

console.log('🔍 Running DOM selector audit...');
walk(ROOT_DIR, analyzeFile);

const definedIds = new Set(idDefinitions.keys());
const referencedIds = Array.from(idReferences.keys()).sort();
const missingIds = referencedIds.filter(id => !definedIds.has(id));
const unusedIds = Array.from(definedIds).filter(id => !idReferences.has(id));

const definedClasses = new Set(classDefinitions.keys());
const referencedClasses = Array.from(classReferences.keys()).sort();
const missingClasses = referencedClasses.filter(cls => !definedClasses.has(cls));
const unusedClasses = Array.from(definedClasses).filter(cls => !classReferences.has(cls));

const definedData = new Set(dataDefinitions.keys());
const referencedData = Array.from(dataReferences.keys()).sort();
const missingData = referencedData.filter(attr => !definedData.has(attr));
const unusedData = Array.from(definedData).filter(attr => !dataReferences.has(attr));

console.log(`\n📊 Summary`);
console.log(`• Unique IDs defined: ${definedIds.size}`);
console.log(`• Unique IDs referenced via getElementById: ${referencedIds.length}`);
console.log(`• Missing IDs: ${missingIds.length}`);
console.log(`• Defined but never queried via getElementById: ${unusedIds.length}`);
console.log(`• Unique classes defined: ${definedClasses.size}`);
console.log(`• Classes referenced in JS: ${referencedClasses.length}`);
console.log(`• Missing classes: ${missingClasses.length}`);
console.log(`• Defined but never referenced (JS): ${unusedClasses.length}`);
console.log(`• Unique data-* attributes defined: ${definedData.size}`);
console.log(`• Data-* attributes referenced in JS: ${referencedData.length}`);
console.log(`• Missing data-* attributes: ${missingData.length}`);
console.log(`• Defined but never referenced data-* attributes: ${unusedData.length}`);

if (missingIds.length) {
  console.log('\n⚠️  IDs referenced but missing definitions:');
  missingIds.forEach(id => {
    console.log(`  - ${id} (referenced in ${Array.from(idReferences.get(id)).join(', ')})`);
  });
} else {
  console.log('\n✅ All document.getElementById references map to existing IDs.');
}

if (unusedIds.length) {
  console.log('\nℹ️  IDs defined but never queried via getElementById (may be used via querySelector or CSS):');
  console.log(unusedIds.slice(0, 20).map(id => `  - ${id}`).join('\n'));
  if (unusedIds.length > 20) {
    console.log(`  ...and ${unusedIds.length - 20} more`);
  }
}

if (missingClasses.length) {
  console.log('\n⚠️  Classes referenced in JS but missing definitions:');
  missingClasses.forEach(cls => {
    console.log(`  - .${cls} (referenced in ${Array.from(classReferences.get(cls)).join(', ')})`);
  });
} else if (referencedClasses.length) {
  console.log('\n✅ All referenced classes exist in markup/templates.');
}

if (unusedClasses.length) {
  console.log('\nℹ️  Classes defined but never referenced via JS (likely styling-only):');
  console.log(unusedClasses.slice(0, 20).map(cls => `  - .${cls}`).join('\n'));
  if (unusedClasses.length > 20) {
    console.log(`  ...and ${unusedClasses.length - 20} more`);
  }
}

if (missingData.length) {
  console.log('\n⚠️  Data attributes referenced in JS but missing definitions:');
  missingData.forEach(attr => {
    console.log(`  - [${attr}] (referenced in ${Array.from(dataReferences.get(attr)).join(', ')})`);
  });
} else if (referencedData.length) {
  console.log('\n✅ All referenced data-* attributes exist in markup/templates.');
}

if (unusedData.length) {
  console.log('\nℹ️  Data attributes defined but never referenced in JS:');
  console.log(unusedData.slice(0, 20).map(attr => `  - [${attr}]`).join('\n'));
  if (unusedData.length > 20) {
    console.log(`  ...and ${unusedData.length - 20} more`);
  }
}

console.log('\n✨ DOM selector audit complete!');
