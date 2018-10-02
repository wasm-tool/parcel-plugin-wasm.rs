# parcel-plugin-wasm.rs

wasm-bindgen support for Parcel bundler

### Requirements
```
cargo
wasm-pack(or wasm-bindgen-cli)
```
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
// OR import { foo } from 'path/to/lib.rs'

console.log(foo('abc'))    // yes
```
