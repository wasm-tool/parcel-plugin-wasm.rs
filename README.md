# parcel-plugin-wasm.rs
wasm-bindgen support for Parcel bundler

### Requirements
* cargo
* wasm-pack

### Installation
```
npm i --save-dev parcel-plugin-wasm.rs
```

### Usage
```rust
extern crate wasm_bindgen;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn foo(x: &str) -> String {
  if x == "abc" {
    "yes".to_string()
  } else {
    "no".to_string()
  }
}
```

```javascript
import { foo } from 'path/to/Cargo.toml'

console.log(foo('abc'))    // yes
```

```javascript
import lib from 'path/to/Cargo.toml'

console.log(lib.wasm)    // original wasm import data
console.log(lib.wasm.memory)    // memory data
```

### With Profile
You can use the cli variable `WASM_PACK_PROFILE={profile}` to change the profile used by `wasm-pack build`.

For example:
`WASM_PACK_PROFILE=dev parcel src/index.html`

The profile list is according to [https://rustwasm.github.io/wasm-pack/book/commands/build.html#profile](https://rustwasm.github.io/wasm-pack/book/commands/build.html#profile).
