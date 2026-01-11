use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;

use crate::domain::ServiceInfo;

pub fn build_service_info(compose_file: &str) -> Vec<ServiceInfo> {
    let (services, ports_by_service) = parse_compose_services_and_ports(compose_file);
    let mut info = Vec::new();
    for name in services {
        let endpoints: Vec<String> = ports_by_service
            .get(&name)
            .map(|ports| {
                ports
                    .iter()
                    .map(|port| format!("http://localhost:{port}"))
                    .collect()
            })
            .unwrap_or_default();
        info.push(ServiceInfo {
            name: name.clone(),
            endpoint: endpoints.first().cloned(),
            exposed: !endpoints.is_empty(),
            endpoints,
        });
    }
    info
}

fn parse_compose_services_and_ports(
    compose_file: &str,
) -> (Vec<String>, HashMap<String, Vec<String>>) {
    let Ok(contents) = fs::read_to_string(compose_file) else {
        return (Vec::new(), HashMap::new());
    };
    let Ok(doc) = serde_yaml::from_str::<serde_yaml::Value>(&contents) else {
        return (Vec::new(), HashMap::new());
    };
    let Some(services_map) = doc.get("services").and_then(serde_yaml::Value::as_mapping) else {
        return (Vec::new(), HashMap::new());
    };

    let mut services = Vec::new();
    let mut ports_by_service: HashMap<String, Vec<String>> = HashMap::new();

    for (name_val, service_val) in services_map {
        let Some(name) = name_val.as_str() else {
            continue;
        };
        let ports = extract_service_ports(service_val);
        let unique = dedup_ports(ports);
        ports_by_service.insert(name.to_string(), unique);
        services.push(name.to_string());
    }

    (services, ports_by_service)
}

fn extract_service_ports(service_val: &serde_yaml::Value) -> Vec<String> {
    let Some(service_map) = service_val.as_mapping() else {
        return Vec::new();
    };
    let Some(list) = service_map
        .get(serde_yaml::Value::String("ports".to_string()))
        .and_then(serde_yaml::Value::as_sequence)
    else {
        return Vec::new();
    };

    let mut ports = Vec::new();
    for entry in list {
        match entry {
            serde_yaml::Value::String(value) => {
                let port =
                    parse_port_short(value).and_then(|host_port| resolve_host_port(&host_port));
                if let Some(port) = port {
                    ports.push(port);
                }
            }
            serde_yaml::Value::Mapping(map) => {
                let port = map
                    .get(serde_yaml::Value::String("published".to_string()))
                    .and_then(yaml_value_to_string)
                    .and_then(|raw| resolve_host_port(&raw));
                if let Some(port) = port {
                    ports.push(port);
                }
            }
            _ => {}
        }
    }
    ports
}

fn dedup_ports(ports: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut unique = Vec::new();
    for port in ports {
        if seen.insert(port.clone()) {
            unique.push(port);
        }
    }
    unique
}

fn yaml_value_to_string(value: &serde_yaml::Value) -> Option<String> {
    match value {
        serde_yaml::Value::String(value) => Some(value.clone()),
        serde_yaml::Value::Number(value) => Some(value.to_string()),
        serde_yaml::Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn strip_quotes(value: &str) -> &str {
    if let Some(stripped) = value.strip_prefix('"').and_then(|v| v.strip_suffix('"')) {
        return stripped;
    }
    if let Some(stripped) = value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')) {
        return stripped;
    }
    value
}

fn resolve_env_value(raw_value: &str) -> String {
    let value = strip_quotes(raw_value.trim());
    if let Some(inner) = value
        .strip_prefix("${")
        .and_then(|rest| rest.strip_suffix('}'))
    {
        if let Some((var, default)) = inner.split_once(":-") {
            return env::var(var).unwrap_or_else(|_| default.to_string());
        }
        return env::var(inner).unwrap_or_default();
    }
    if let Some(var) = value.strip_prefix('$') {
        return env::var(var).unwrap_or_default();
    }
    value.to_string()
}

fn parse_port_short(value: &str) -> Option<String> {
    let entry = strip_quotes(value.trim());
    if entry.is_empty() {
        return None;
    }
    let entry = entry.split('/').next().unwrap_or(entry);
    let parts: Vec<&str> = entry.split(':').collect();
    let first = parts.first()?.trim();
    if parts.len() == 1 {
        return None;
    }
    if parts.len() >= 3 {
        let second = parts.get(1)?;
        if first.contains('.') || first == "localhost" || first == "0.0.0.0" {
            return Some(second.trim().to_string());
        }
        return Some(first.to_string());
    }
    Some(first.to_string())
}

fn resolve_host_port(raw_port: &str) -> Option<String> {
    let value = resolve_env_value(raw_port).trim().to_string();
    if value.is_empty() || value == "0" {
        return None;
    }
    if value.chars().all(|c| c.is_ascii_digit()) {
        return Some(value);
    }
    None
}
