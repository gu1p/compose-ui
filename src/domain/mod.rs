use serde::Serialize;

pub mod traffic;

#[derive(Clone, Serialize)]
pub struct ServiceInfo {
    pub name: String,
    pub endpoints: Vec<String>,
    pub endpoint: Option<String>,
    pub exposed: bool,
}

#[derive(Clone, Serialize)]
pub struct LogEvent {
    pub seq: u64,
    pub service: String,
    pub container_ts: Option<String>,
    pub line: String,
}

#[derive(Clone, Copy)]
pub enum Scope {
    Running,
    All,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum EngineKind {
    Podman,
    Docker,
}
