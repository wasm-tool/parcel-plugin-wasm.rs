# parcel-plugin-rustwasm

wasm-bindgen support for Parcel bundler

### Requirements
```
cargo
wasm-pack = "^0.5.0" or wasm-bindgen-cli
```

### How to use
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
import { foo } from './your_lib.rs'
console.log(foo('abc'))    // yes
```
