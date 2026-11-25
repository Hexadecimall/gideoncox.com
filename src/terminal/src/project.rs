#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "ark_project")]
extern "C" {
    fn request(input: *const u8, len: usize) -> usize;
    fn response(output: *mut u8);
}

#[cfg(target_arch = "wasm32")]
pub fn call(operation: &str, arguments: &[&str]) -> Result<Vec<String>, String> {
    let fields = std::iter::once(operation)
        .chain(arguments.iter().copied())
        .map(str::to_string)
        .collect::<Vec<_>>();
    let input = super::encode(&fields);
    let length = unsafe { request(input.as_ptr(), input.len()) };
    if !(4..=2 * 1024 * 1024).contains(&length) {
        return Err("invalid project filesystem response".into());
    }
    let mut result = vec![0_u8; length];
    unsafe { response(result.as_mut_ptr()) };
    let mut values = super::decode(&result)?.into_iter();
    match values.next().as_deref() {
        Some("0") => Ok(values.collect()),
        Some("1") => Err(values
            .next()
            .unwrap_or_else(|| "project filesystem error".into())),
        _ => Err("invalid project filesystem status".into()),
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub fn call(_operation: &str, _arguments: &[&str]) -> Result<Vec<String>, String> {
    Err("project filesystem requires the browser".into())
}
