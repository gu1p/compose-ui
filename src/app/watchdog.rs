use std::thread;
use std::time::Duration;

use crate::app::runner::{ComposeRunner, ComposeRunnerConfig};
use crate::domain::EngineKind;
use crate::infra::compose::detect_compose_cmd;
use crate::infra::engine::Engine;
use crate::infra::process::{command_exists, pid_alive};

pub fn run_watchdog(
    parent_pid: i32,
    project_name: &str,
    compose_file: &str,
    connection: Option<String>,
) {
    if parent_pid <= 0 {
        return;
    }
    while pid_alive(parent_pid) {
        thread::sleep(Duration::from_secs(1));
    }
    let (compose_cmd, engine_kind) = if command_exists("podman") {
        (
            vec!["podman".to_string(), "compose".to_string()],
            EngineKind::Podman,
        )
    } else {
        let selection = match detect_compose_cmd(None) {
            Ok(selection) => selection,
            Err(err) => {
                eprintln!("{err}");
                return;
            }
        };
        (selection.compose_cmd, selection.engine)
    };
    let engine = Engine::new(engine_kind, &compose_cmd).with_connection(connection);
    let mut runner = ComposeRunner::new(ComposeRunnerConfig {
        compose_cmd,
        engine,
        compose_file: compose_file.to_string(),
        project_name: project_name.to_string(),
        args: Vec::new(),
    });
    runner.set_project_args(vec!["-p".to_string(), project_name.to_string()]);
    runner.enable_cleanup();
    runner.cleanup_once();
}
