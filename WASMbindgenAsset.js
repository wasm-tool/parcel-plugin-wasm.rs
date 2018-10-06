const { Asset } = require('parcel-bundler')
const commandExists = require('command-exists')
const toml = require('toml')
const path = require('path')
const util = require('util')
const exec = util.promisify(require('child_process').execFile)
const lib = require('./lib')

const RUST_TARGET = 'wasm32-unknown-unknown'

const cmdExists = async (cmd) => {
  try {
    await commandExists(cmd)
    return true
  } catch (e) {
    return false
  }
}

class WASMbindgenAsset extends Asset {
  constructor(name, options) {
    super(name, options)
  }

  process() {
    if (this.options.isWarmUp) {
      return
    }

    return super.process()
  }

  isCargoTOML() {
    return path.basename(this.name) === 'Cargo.toml'
  }

  async crateTypeCheck(cargoConfig) {
    if (!cargoConfig.lib ||
        !Array.isArray(cargoConfig.lib['crate-type']) ||
        !cargoConfig.lib['crate-type'].includes('cdylib')) {
      throw 'The `crate-type` in Cargo.toml should be `cdylib`'
    }

    return cargoConfig
  }

  async parse(code) {
    if (!this.isCargoTOML()) {
      return toml.parse(code)
    }

    const cargoConfig = await this.getConfig(['Cargo.toml'])
    const cargoDir = path.dirname(await lib.resolve(this.name, ['Cargo.toml']))
    await this.crateTypeCheck(cargoConfig)

    const has_wasm_pack = await cmdExists('wasm-pack')
    const has_cargo = await cmdExists('cargo')
    const has_wasmbindgen = await cmdExists('wasm-bindgen')

    const build_result = {
      cargoDir
    }

    if (has_wasm_pack) {
      Object.assign(build_result, await this.wasmPackBuild(cargoConfig, cargoDir, has_cargo && has_wasmbindgen))
    } else if (has_cargo) {
      if (has_wasmbindgen) {
        Object.assign(build_result, await this.rawBuild(cargoConfig, cargoDir))
      } else {
        throw 'Please install wasm-pack'
      }
    } else {
      throw 'Please install Cargo for Rust'
    }

    await this.wasmPostProcess(build_result)
  }

  async wasmPackBuild(cargoConfig, cargoDir, has_deps) {
    const hasBuildCommand = await exec('wasm-pack', ['build', '--help']).then(() => true).catch(() => false);

    let args;
    if (hasBuildCommand) {
      args = has_deps ? ['build', '-m', 'no-install'] : ['build']
    } else {
      args = has_deps ? ['init', '-m', 'no-install'] : ['init']
    }

    await exec('wasm-pack', args, {
      cwd: cargoDir
    })

    return {
      outDir: cargoDir + '/pkg',
      rustName: cargoConfig.package.name.replace(/-/g, '_'),
      loc: path.join(cargoDir, 'pkg')
    }
  }

  async rawBuild(cargoConfig, cargoDir) {
    // Run cargo
    let args = ['+nightly', 'build', '--target', RUST_TARGET, '--release']
    await exec('cargo', args, {cwd: cargoDir})

    // Get output file paths
    let { stdout } = await exec('cargo', ['metadata', '--format-version', '1'], {
      cwd: cargoDir
    })
    const cargoMetadata = JSON.parse(stdout)
    const cargoTargetDir = cargoMetadata.target_directory
    let outDir = path.join(cargoTargetDir, RUST_TARGET, 'release')

    // Rust converts '-' to '_' when outputting files.
    let rustName = cargoConfig.package.name.replace(/-/g, '_')

    // Build with wasm-bindgen
    args = [path.join(outDir, rustName + '.wasm'), '--out-dir', outDir]
    await exec('wasm-bindgen', args, {cwd: cargoDir})

    return {
      outDir,
      rustName,
      loc: path.join(cargoDir, 'target', RUST_TARGET, 'release')
    }
  }

  async wasmPostProcess({cargoDir, loc, outDir, rustName}) {
    let js_content = (await lib.readFile(path.join(outDir, rustName + '.js'))).toString()
    let wasm_path = path.relative(path.dirname(this.name), path.join(loc, rustName + '_bg.wasm'))
    if (wasm_path[0] !== '.')
      wasm_path = './' + wasm_path

    js_content = js_content.replace(/import\ \*\ as\ wasm.+?;/, 'var wasm;const __exports = {};')

    const exports_line = []
    js_content = js_content.replace(/export\ function\ \w+/g, x => {
      const name = x.slice(15)
      exports_line.push(`export const ${name} = wasm.${name}`)
      return '__exports.' + name + ' = function'
    })

    this.wasm_bindgen_js = `
      import wasm from '${wasm_path}'
      ${exports_line.join('\n')}
    `

    const wasm_loader = js_content + `
      function init(wasm_path) {
          const fetchPromise = fetch(wasm_path);
          let resultPromise;
          if (typeof WebAssembly.instantiateStreaming === 'function') {
              resultPromise = WebAssembly.instantiateStreaming(fetchPromise, { './${rustName}': __exports });
          } else {
              resultPromise = fetchPromise
              .then(response => response.arrayBuffer())
              .then(buffer => WebAssembly.instantiate(buffer, { './${rustName}': __exports }));
          }
          return resultPromise.then(({instance}) => {
              wasm = init.wasm = instance.exports;
              return;
          });
      };
      const wasm_bindgen = Object.assign(init, __exports);
      module.exports = function loadWASMBundle(bundle) {
            return wasm_bindgen(bundle).then(() => __exports)
      }
    `

    await lib.writeFile(require.resolve('./wasm-loader.js'), wasm_loader)
    this.depsPath = path.join(cargoDir,  'target', RUST_TARGET, 'release', rustName + '.d')
  }

  async collectDependencies() {
    if (!this.isCargoTOML())
      return false

    // Read deps file
    let contents = await lib.readFile(this.depsPath, 'utf8')
    let dir = path.dirname(this.name)

    let deps = contents.trim().split(':')[1].split(' ').filter(x => x)

    for (let dep of deps) {
      if (dep !== this.name) {
        this.addDependency(dep, {includedInParent: true})
      }
    }
  }

  async generate() {
    if (this.isCargoTOML()) {
      return [
        {
          type: 'js',
          value: this.wasm_bindgen_js
        }
      ]
    } else {
      this.type = 'js'
      return lib.serializeObject(
        this.ast,
        this.options.minify && !this.options.scopeHoist
      )
    }
  }
}

module.exports = WASMbindgenAsset
