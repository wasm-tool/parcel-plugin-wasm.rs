const { Asset } = require('parcel-bundler')
const commandExists = require('command-exists')
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

  async crateTypeCheck(cargoConfig) {
    if (!cargoConfig.lib || 
        !Array.isArray(cargoConfig.lib['crate-type']) ||
        !cargoConfig.lib['crate-type'].includes('cdylib')) {
      throw 'The `crate-type` in Cargo.toml should be `cdylib`'
    }

    return cargoConfig
  }

  async parse() {
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
        throw 'Please install wasm-bindgen-cli'
      }
    } else {
      throw 'Please install Cargo for Rust'
    }

    await wasmPostProcess(build_result)
  }

  async wasmPackBuild(cargoConfig, cargoDir, has_deps) {
    const args = has_deps ? ['init', '-m', 'no-install'] : ['init']
    await exec('wasm-pack', args, {cwd: cargoDir})

    return {
      outDir: cargoDir + '/pkg',
      rustName: cargoConfig.package.name.replace(/-/g, '_')
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
    args = [path.join(outDir, rustName + '.wasm'), '--no-modules', '--out-dir', outDir]
    await exec('wasm-bindgen', args, {cwd: cargoDir})

    return {
      outDir,
      rustName
    }
  }

  async wasmPostProcess({cargoDir, outDir, rustName}) {
    const js_file = (await lib.readFile(path.join(outDir, rustName + '.js'))).toString()
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
      .replace(/\}\)\(\)\s+$/, '')
      .replace('self.wasm_bindgen', 'const wasm_bindgen') + '\n' +
      `
       module.exports = function loadWASMBundle(bundle) {
         return wasm_bindgen(bundle).then(() => __exports)
       }
      `
    await lib.writeFile(require.resolve('./wasm-loader.js'), wasm_loader)
    this.depsPath = path.join(outDir, rustName + '.d')
  }

  async collectDependencies() {
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
    return [
      {
        type: 'js',
        value: this.wasm_bindgen_js
      }
    ]
  }
}

module.exports = WASMbindgenAsset