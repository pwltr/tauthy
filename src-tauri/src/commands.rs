use tauri::command;

// #[derive(Debug)]
// pub struct MyState {
//   #[allow(dead_code)]
//   value: u64,
//   #[allow(dead_code)]
//   label: String,
// }

#[derive(Debug, serde::Serialize)]
pub enum MyError {
  FooError,
}

// #[command]
// pub fn simple_command(argument: String) {
//   println!("{}", argument);
// }

#[command]
pub fn make_totp(argument: String) -> Result<u32, MyError> {
  println!("call from frontend with arg: {}", argument);
  (!argument.is_empty())
    .then(|| {
      let totp = otp::make_totp(&(argument.to_ascii_uppercase()), 30, 0).unwrap();
      println!("totp is: {}", totp);
      totp
    })
    .ok_or(MyError::FooError)
}
