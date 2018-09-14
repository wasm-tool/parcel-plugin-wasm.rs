const { Asset } = require('parcel-bundler')
const path = require('path');
const childProcess = require('child_process');
const util = require('util')
const exec = util.promisify(childProcess.execFile);
const fs = require('./fs')

const existsCache = new Map();
async function resolve(filepath, filenames, root = path.parse(filepath).root) {
  filepath = path.dirname(filepath);

  // Don't traverse above the module root
  if (filepath === root || path.basename(filepath) === 'node_modules') {
    return null;
  }

  for (const filename of filenames) {
    let file = path.join(filepath, filename);
    let exists = existsCache.has(file)
      ? existsCache.get(file)
      : await fs.exists(file);
    if (exists) {
      existsCache.set(file, true);
      return file;
    }
  }

  return resolve(filepath, filenames, root);
}

const RUST_TARGET = 'wasm32-unknown-unknown';

class WASMbindgenAsset extends Asset {
  constructor(name, options) {
    super(name, options)
  }

  process() {
    // We don't want to process this asset if the worker is in a warm up phase
    // since the asset will also be processed by the main process, which
    // may cause errors since rust writes to the filesystem.
    if (this.options.isWarmUp) {
      return;
    }

    return super.process();
  }

  async parse() {
    const cargoConfig = await this.getConfig(['Cargo.toml']);
    const cargoDir = path.dirname(await resolve(this.name, ['Cargo.toml']));
    await this.cargoBuild(cargoConfig, cargoDir)
  }

  async cargoBuild(cargoConfig, cargoDir) {
    // Ensure the cargo config has cdylib as the crate-type
    if (!cargoConfig.lib) {
      cargoConfig.lib = {};
    }

    if (!Array.isArray(cargoConfig.lib['crate-type'])) {
      cargoConfig.lib['crate-type'] = [];
    }

    if (!cargoConfig.lib['crate-type'].includes('cdylib')) {
      cargoConfig.lib['crate-type'].push('cdylib');
      await fs.writeFile(
        path.join(cargoDir, 'Cargo.toml'),
        tomlify.toToml(cargoConfig)
      );
    }

    // Run cargo
    let args = ['+nightly', 'build', '--target', RUST_TARGET, '--release'];
    await exec('cargo', args, {cwd: cargoDir});

    // Get output file paths
    let { stdout } = await exec('cargo', ['metadata', '--format-version', '1'], {
      cwd: cargoDir
    });
    const cargoMetadata = JSON.parse(stdout);
    const cargoTargetDir = cargoMetadata.target_directory;
    let outDir = path.join(cargoTargetDir, RUST_TARGET, 'release');

    // Rust converts '-' to '_' when outputting files.
    let rustName = cargoConfig.package.name.replace(/-/g, '_');

    // FOR WASM-BINDGEN
    args = [path.join(outDir, rustName + '.wasm'), '--no-modules', '--out-dir', outDir]
    await exec('wasm-bindgen', args, {cwd: cargoDir})
    const js_file = (await fs.readFile(path.join(outDir, rustName + '.js'))).toString()
    const wasm_path = path.relative(path.dirname(this.name), path.join(cargoDir, 'target', RUST_TARGET, 'release', rustName + '_bg.wasm'))
    const exports_line = js_file.match(/__exports\.\w+/g).map(x => {
      const name = x.slice(10)
      return `export const ${name} = wasm.${name}`
    })
    this.wasm_bindgen_js = `
      import wasm from '${wasm_path}'
      ${exports_line.join('\n')}
    `
    
    const wasm_loader = js_file
      .replace(/^\s+\(function\(\)\ \{/, '')
      .replace(/\}\)\(\);\s+$/, '')
      .replace('self.wasm_bindgen', 'const wasm_bindgen') + '\n' +
      `
       module.exports = function loadWASMBundle(bundle) {
         return wasm_bindgen(bundle).then(() => __exports)
       }
      `
    await fs.writeFile(require.resolve('./wasm-loader.js'), wasm_loader)
    this.depsPath = path.join(outDir, rustName + '.d');
  }

  async collectDependencies() {
    // Read deps file
    let contents = await fs.readFile(this.depsPath, 'utf8');
    let dir = path.dirname(this.name);

    let deps = contents.trim().split(':')[1].split(' ').filter(x => x)

    for (let dep of deps) {
      if (dep !== this.name) {
        this.addDependency(dep, {includedInParent: true});
      }
    }
  }

  async generate() {
    return [
      {
        type: 'js',
        value: this.wasm_bindgen_js
      }
    ]
  }
}

module.exports = WASMbindgenAsset;