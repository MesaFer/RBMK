#!/usr/bin/env node
/**
 * Code Snapshot Tool
 * Creates a "snapshot" of code files in a directory
 * Outputs formatted code blocks with file paths
 */

const fs = require('fs');
const path = require('path');

// Language configurations for syntax highlighting hints
const LANGUAGE_MAP = {
    // Rust
    '.rs': 'rust',
    // Fortran
    '.f90': 'fortran',
    '.f95': 'fortran',
    '.f03': 'fortran',
    '.f08': 'fortran',
    '.f': 'fortran',
    '.for': 'fortran',
    // JavaScript/TypeScript
    '.js': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.jsx': 'jsx',
    // Web
    '.html': 'html',
    '.htm': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.sass': 'sass',
    '.less': 'less',
    // Data formats
    '.json': 'json',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.xml': 'xml',
    '.toml': 'toml',
    // Python
    '.py': 'python',
    '.pyw': 'python',
    // C/C++
    '.c': 'c',
    '.h': 'c',
    '.cpp': 'cpp',
    '.hpp': 'cpp',
    '.cc': 'cpp',
    '.cxx': 'cpp',
    // Shell
    '.sh': 'bash',
    '.bash': 'bash',
    '.zsh': 'zsh',
    '.fish': 'fish',
    '.ps1': 'powershell',
    '.bat': 'batch',
    '.cmd': 'batch',
    // Other
    '.md': 'markdown',
    '.sql': 'sql',
    '.go': 'go',
    '.java': 'java',
    '.kt': 'kotlin',
    '.swift': 'swift',
    '.rb': 'ruby',
    '.php': 'php',
    '.lua': 'lua',
    '.r': 'r',
    '.R': 'r',
    '.vue': 'vue',
    '.svelte': 'svelte',
};

// Default ignore patterns (directories only by default)
const DEFAULT_IGNORE = [
    'node_modules',
    '.git',
    '.svn',
    '.hg',
    'target',
    '__pycache__',
    '.cache',
];

// Binary file extensions to skip (can't be displayed as text)
const BINARY_EXTENSIONS = [
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.bmp', '.icns',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.zip', '.tar', '.gz', '.rar', '.7z',
    '.exe', '.dll', '.so', '.dylib', '.bin',
    '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv',
    '.o', '.obj', '.a', '.lib', '.mod',  // .mod = Fortran compiled modules
];

/**
 * Check if a path should be ignored
 */
function shouldIgnore(filePath, ignorePatterns) {
    const basename = path.basename(filePath);
    
    for (const pattern of ignorePatterns) {
        // Exact match
        if (basename === pattern) return true;
        
        // Wildcard pattern (simple glob)
        if (pattern.startsWith('*')) {
            const ext = pattern.slice(1);
            if (basename.endsWith(ext)) return true;
        }
        
        // Directory in path
        if (filePath.includes(path.sep + pattern + path.sep) || 
            filePath.includes('/' + pattern + '/') ||
            filePath.startsWith(pattern + path.sep) ||
            filePath.startsWith(pattern + '/')) {
            return true;
        }
    }
    
    return false;
}

/**
 * Check if file is binary based on extension
 */
function isBinaryFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return BINARY_EXTENSIONS.includes(ext);
}

/**
 * Get language identifier for syntax highlighting
 */
function getLanguage(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return LANGUAGE_MAP[ext] || '';
}

/**
 * Recursively collect all files in a directory
 */
function collectFiles(dir, baseDir, ignorePatterns, extensions) {
    const files = [];
    
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(baseDir, fullPath);
            
            if (shouldIgnore(relativePath, ignorePatterns)) {
                continue;
            }
            
            if (entry.isDirectory()) {
                files.push(...collectFiles(fullPath, baseDir, ignorePatterns, extensions));
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                
                // Skip binary files
                if (isBinaryFile(fullPath)) {
                    continue;
                }
                
                // If extensions filter is provided, only include matching files
                if (extensions && extensions.length > 0) {
                    if (!extensions.includes(ext)) continue;
                }
                
                // Include ALL text files (not just known languages)
                files.push({
                    path: relativePath.replace(/\\/g, '/'),
                    fullPath: fullPath,
                    language: getLanguage(fullPath)
                });
            }
        }
    } catch (err) {
        console.error(`Error reading directory ${dir}:`, err.message);
    }
    
    return files;
}

/**
 * Read file content safely
 */
function readFileContent(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
        return `// Error reading file: ${err.message}`;
    }
}

/**
 * Count lines in a string
 */
function countLines(content) {
    if (!content) return 0;
    return content.split('\n').length;
}

/**
 * Create a snapshot of the codebase
 */
function createSnapshot(targetDir, options = {}) {
    const {
        ignorePatterns = DEFAULT_IGNORE,
        extensions = null,
        includeEmpty = false,
        outputFormat = 'markdown',
        maxLines = null  // null means no limit
    } = options;
    
    const baseDir = path.resolve(targetDir);
    const files = collectFiles(baseDir, baseDir, ignorePatterns, extensions);
    
    // Sort files by path for consistent output
    files.sort((a, b) => a.path.localeCompare(b.path));
    
    let output = '';
    let includedCount = 0;
    const skippedFiles = [];
    
    for (const file of files) {
        const content = readFileContent(file.fullPath);
        
        // Skip empty files unless includeEmpty is true
        if (!includeEmpty && content.trim() === '') {
            continue;
        }
        
        // Skip files exceeding maxLines limit
        if (maxLines !== null) {
            const lineCount = countLines(content);
            if (lineCount > maxLines) {
                skippedFiles.push({ path: file.path, lines: lineCount });
                continue;
            }
        }
        
        includedCount++;
        
        if (outputFormat === 'markdown') {
            output += `${file.path}\n`;
            output += '```' + file.language + '\n';
            output += content;
            if (!content.endsWith('\n')) {
                output += '\n';
            }
            output += '```\n\n';
        } else if (outputFormat === 'plain') {
            output += `=== ${file.path} ===\n`;
            output += content;
            if (!content.endsWith('\n')) {
                output += '\n';
            }
            output += '\n';
        }
    }
    
    // Build list of included files (excluding skipped ones)
    const skippedPaths = new Set(skippedFiles.map(f => f.path));
    const includedFiles = files
        .filter(f => !skippedPaths.has(f.path))
        .map(f => f.path);
    
    return {
        output,
        fileCount: includedCount,
        totalFiles: files.length,
        skippedFiles,
        files: includedFiles
    };
}

/**
 * CLI interface
 */
function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        console.log(`
Code Snapshot Tool
==================

Usage: node snapshot.js <directory> [options]

Options:
  -o, --output <file>     Write output to file instead of stdout
  -e, --ext <extensions>  Filter by extensions (comma-separated, e.g., ".js,.ts")
  -i, --ignore <patterns> Additional ignore patterns (comma-separated)
  -f, --format <format>   Output format: markdown (default) or plain
  -m, --max-lines <num>   Skip files with more than <num> lines (default: no limit)
  --include-empty         Include empty files
  --list                  Only list files, don't output content
  -h, --help              Show this help message

Examples:
  node snapshot.js ./src
  node snapshot.js ./src -o snapshot.md
  node snapshot.js ./src -e ".js,.ts" -o snapshot.md
  node snapshot.js . --ignore "test,spec" -o snapshot.md
  node snapshot.js . --max-lines 5000 -o snapshot.md
`);
        process.exit(0);
    }
    
    const targetDir = args[0];
    const options = {
        ignorePatterns: [...DEFAULT_IGNORE],
        extensions: null,
        includeEmpty: false,
        outputFormat: 'markdown',
        maxLines: null
    };
    
    let outputFile = null;
    let listOnly = false;
    
    // Parse arguments
    for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        
        if (arg === '-o' || arg === '--output') {
            outputFile = args[++i];
        } else if (arg === '-e' || arg === '--ext') {
            options.extensions = args[++i].split(',').map(e => e.trim().toLowerCase());
        } else if (arg === '-i' || arg === '--ignore') {
            options.ignorePatterns.push(...args[++i].split(',').map(p => p.trim()));
        } else if (arg === '-f' || arg === '--format') {
            options.outputFormat = args[++i];
        } else if (arg === '-m' || arg === '--max-lines') {
            options.maxLines = parseInt(args[++i], 10);
            if (isNaN(options.maxLines) || options.maxLines <= 0) {
                console.error('Error: --max-lines must be a positive integer');
                process.exit(1);
            }
        } else if (arg === '--include-empty') {
            options.includeEmpty = true;
        } else if (arg === '--list') {
            listOnly = true;
        }
    }
    
    // Check if target directory exists
    if (!fs.existsSync(targetDir)) {
        console.error(`Error: Directory "${targetDir}" does not exist`);
        process.exit(1);
    }
    
    const result = createSnapshot(targetDir, options);
    
    if (listOnly) {
        console.log(`Found ${result.fileCount} files (${result.totalFiles} total, ${result.skippedFiles.length} skipped):\n`);
        result.files.forEach(f => console.log(`  ${f}`));
        if (result.skippedFiles.length > 0 && options.maxLines) {
            console.log(`\nSkipped ${result.skippedFiles.length} files exceeding ${options.maxLines} lines:`);
            result.skippedFiles.forEach(f => console.log(`  ${f.path} (${f.lines} lines)`));
        }
    } else {
        if (outputFile) {
            fs.writeFileSync(outputFile, result.output, 'utf-8');
            let message = `Snapshot written to ${outputFile} (${result.fileCount} files)`;
            if (result.skippedFiles.length > 0) {
                message += `\nSkipped ${result.skippedFiles.length} files exceeding ${options.maxLines} lines:`;
                result.skippedFiles.forEach(f => {
                    message += `\n  ${f.path} (${f.lines} lines)`;
                });
            }
            console.log(message);
        } else {
            console.log(result.output);
        }
    }
}

// Export for use as module
module.exports = { createSnapshot, LANGUAGE_MAP, DEFAULT_IGNORE };

// Run CLI if executed directly
if (require.main === module) {
    main();
}
