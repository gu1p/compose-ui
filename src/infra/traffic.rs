use std::collections::BTreeMap;
use std::net::{IpAddr, SocketAddr};

use crate::domain::traffic::{
    Confidence, Correlation, EntityId, FlowKey, FlowMetrics, FlowObservation, HttpObservation,
    Observation, ObservationAttrs, Peer, Resolver, Socket, Transport, Visibility,
};

#[derive(Default)]
pub struct EnvoyAccessLog {
    #[allow(dead_code)]
    pub timestamp: Option<String>,
    pub method: Option<String>,
    pub path: Option<String>,
    pub authority: Option<String>,
    #[allow(dead_code)]
    pub protocol: Option<String>,
    pub response_code: Option<u16>,
    pub duration_ms: Option<u64>,
    pub downstream_remote_address: Option<String>,
    pub upstream_host: Option<String>,
    pub bytes_received: Option<u64>,
    pub bytes_sent: Option<u64>,
    pub request_id: Option<String>,
}

pub fn parse_envoy_log_line(line: &str) -> Option<EnvoyAccessLog> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    let obj = value.as_object()?;
    Some(EnvoyAccessLog {
        timestamp: obj
            .get("timestamp")
            .and_then(|v| v.as_str())
            .map(ToString::to_string),
        method: obj
            .get("method")
            .and_then(|v| v.as_str())
            .map(ToString::to_string),
        path: obj
            .get("path")
            .and_then(|v| v.as_str())
            .map(ToString::to_string),
        authority: obj
            .get("authority")
            .and_then(|v| v.as_str())
            .map(ToString::to_string),
        protocol: obj
            .get("protocol")
            .and_then(|v| v.as_str())
            .map(ToString::to_string),
        response_code: obj
            .get("response_code")
            .and_then(value_to_u64)
            .and_then(|value| u16::try_from(value).ok()),
        duration_ms: obj.get("duration_ms").and_then(value_to_u64),
        downstream_remote_address: obj
            .get("downstream_remote_address")
            .and_then(|v| v.as_str())
            .map(ToString::to_string),
        upstream_host: obj
            .get("upstream_host")
            .and_then(|v| v.as_str())
            .map(ToString::to_string),
        bytes_received: obj.get("bytes_received").and_then(value_to_u64),
        bytes_sent: obj.get("bytes_sent").and_then(value_to_u64),
        request_id: obj
            .get("request_id")
            .and_then(|v| v.as_str())
            .map(ToString::to_string),
    })
}

pub fn observation_from_envoy(
    log: EnvoyAccessLog,
    service_name: &str,
    resolver: &dyn Resolver,
    is_egress: bool,
    now_ms: u64,
) -> Option<Observation> {
    let downstream = log
        .downstream_remote_address
        .as_deref()
        .and_then(parse_socket);
    let upstream = log.upstream_host.as_deref().and_then(parse_socket);
    let src_entity = downstream
        .as_ref()
        .and_then(|socket| resolver.resolve_entity(socket));
    let dst_entity = resolve_dst_entity(&log, is_egress, service_name, upstream.as_ref());
    let confidence = resolve_confidence(src_entity.as_ref(), dst_entity.as_ref());
    let peer = build_peer(src_entity, dst_entity, downstream.clone(), upstream.clone());
    let attrs = build_attrs(&log, confidence);

    if attrs.visibility == Visibility::L7Semantics {
        let path = build_http_path(&log, is_egress);
        return Some(Observation::Http(HttpObservation {
            at_ms: now_ms,
            peer,
            method: log.method,
            path,
            status: log.response_code,
            duration_ms: log.duration_ms,
            bytes_in: log.bytes_received,
            bytes_out: log.bytes_sent,
            correlation: Correlation {
                request_id: log.request_id,
                ..Default::default()
            },
            attrs,
        }));
    }

    let flow = build_flow_key(peer.raw.clone(), downstream, upstream)?;
    Some(Observation::Flow(FlowObservation {
        at_ms: now_ms,
        flow,
        metrics: FlowMetrics {
            bytes_in: log.bytes_received,
            bytes_out: log.bytes_sent,
            packets: None,
            duration_ms: log.duration_ms,
        },
        peer,
        attrs,
    }))
}

fn resolve_dst_entity(
    log: &EnvoyAccessLog,
    is_egress: bool,
    service_name: &str,
    upstream: Option<&Socket>,
) -> Option<EntityId> {
    if is_egress {
        parse_external_entity(log.authority.as_deref().or(log.upstream_host.as_deref())).or_else(
            || {
                upstream.map(|socket| EntityId::External {
                    ip: socket.ip,
                    dns_name: None,
                })
            },
        )
    } else {
        Some(EntityId::Workload {
            name: service_name.to_string(),
            instance: None,
        })
    }
}

const fn resolve_confidence(
    src_entity: Option<&EntityId>,
    dst_entity: Option<&EntityId>,
) -> Confidence {
    if src_entity.is_some() && dst_entity.is_some() {
        Confidence::Exact
    } else {
        Confidence::Likely
    }
}

const fn build_peer(
    src: Option<EntityId>,
    dst: Option<EntityId>,
    downstream: Option<Socket>,
    upstream: Option<Socket>,
) -> Peer {
    let raw = match (downstream, upstream) {
        (Some(src), Some(dst)) => Some(FlowKey {
            src,
            dst,
            transport: Transport::Tcp,
        }),
        _ => None,
    };
    Peer { src, dst, raw }
}

fn build_attrs(log: &EnvoyAccessLog, confidence: Confidence) -> ObservationAttrs {
    let visibility = if log.method.is_some() || log.path.is_some() || log.authority.is_some() {
        Visibility::L7Semantics
    } else {
        Visibility::L4Flow
    };
    ObservationAttrs {
        visibility,
        confidence,
        tags: BTreeMap::default(),
    }
}

fn build_http_path(log: &EnvoyAccessLog, is_egress: bool) -> Option<String> {
    if !is_egress {
        return log.path.clone();
    }
    let authority = log.authority.clone().or_else(|| log.upstream_host.clone());
    if let Some(authority) = authority {
        return log
            .path
            .clone()
            .map(|path| format!("{authority}{path}"))
            .or(Some(authority));
    }
    log.path.clone()
}

fn build_flow_key(
    peer_raw: Option<FlowKey>,
    downstream: Option<Socket>,
    upstream: Option<Socket>,
) -> Option<FlowKey> {
    if let Some(flow) = peer_raw {
        return Some(flow);
    }
    let src = downstream?;
    let dst = upstream?;
    Some(FlowKey {
        src,
        dst,
        transport: Transport::Tcp,
    })
}

fn parse_socket(raw: &str) -> Option<Socket> {
    if let Ok(sock) = raw.parse::<SocketAddr>() {
        return Some(Socket {
            ip: sock.ip(),
            port: sock.port(),
        });
    }
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let (host, port) = raw.rsplit_once(':')?;
    let host = host.trim_matches(['[', ']']);
    let ip = host.parse::<IpAddr>().ok()?;
    let port = port.parse::<u16>().ok()?;
    Some(Socket { ip, port })
}

fn parse_external_entity(raw: Option<&str>) -> Option<EntityId> {
    let raw = raw?;
    let value = raw.trim();
    if value.is_empty() {
        return None;
    }
    let (host, _) = value.rsplit_once(':').unwrap_or((value, ""));
    let host = host.trim_matches(['[', ']']);
    if let Ok(ip) = host.parse::<IpAddr>() {
        return Some(EntityId::External { ip, dns_name: None });
    }
    Some(EntityId::External {
        ip: IpAddr::from([0, 0, 0, 0]),
        dns_name: Some(host.to_string()),
    })
}

fn value_to_u64(value: &serde_json::Value) -> Option<u64> {
    if let Some(value) = value.as_u64() {
        return Some(value);
    }
    if let Some(value) = value.as_str() {
        return value.parse::<u64>().ok();
    }
    None
}
