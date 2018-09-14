const fs = require('fs')

const wasm_loader_path = __dirname + '/wasm-loader.js'
if (!fs.existsSync(wasm_loader_path)) {
  fs.writeFileSync(wasm_loader_path, '')
}

module.exports = function (bundler) {
  bundler.addBundleLoader('wasm', require.resolve('./wasm-loader'))
  bundler.addAssetType('rs', require.resolve('./WASMbindgenAsset'))
}