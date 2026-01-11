#![warn(
    clippy::pedantic,
    clippy::nursery,
    clippy::cognitive_complexity,
    clippy::too_many_lines,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::panic_in_result_fn,
    clippy::indexing_slicing,
    clippy::todo,
    clippy::unimplemented,
    clippy::dbg_macro,
    clippy::print_stdout,
    clippy::exit
)]

mod app;
mod domain;
mod infra;
mod support;

fn main() -> std::process::ExitCode {
    app::run()
}
