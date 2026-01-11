use crossbeam_channel::{bounded, Receiver, Sender, TrySendError};
use std::borrow::Cow;
use std::collections::{HashSet, VecDeque};
use std::io::{BufRead, BufReader, Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use crate::domain::LogEvent;
use crate::support::constants::CLIENT_QUEUE_SIZE;
use crate::support::multiline::MultilineAggregator;

struct LogHubState {
    history: VecDeque<LogEvent>,
    clients: Vec<(usize, Sender<LogEvent>)>,
    next_client_id: usize,
}

pub struct LogHub {
    state: Mutex<LogHubState>,
    seq: AtomicU64,
    history_size: usize,
}

impl LogHub {
    pub fn new(history_size: usize) -> Self {
        Self {
            state: Mutex::new(LogHubState {
                history: VecDeque::with_capacity(history_size),
                clients: Vec::new(),
                next_client_id: 1,
            }),
            seq: AtomicU64::new(0),
            history_size,
        }
    }

    pub fn publish(&self, service: &str, line: &str, container_ts: Option<&str>) {
        let seq = self.seq.fetch_add(1, Ordering::SeqCst) + 1;
        let event = LogEvent {
            seq,
            service: if service.is_empty() {
                "unknown".to_string()
            } else {
                service.to_string()
            },
            container_ts: container_ts.map(ToString::to_string),
            line: line.to_string(),
        };
        let clients = {
            let mut state = self.state();
            state.history.push_back(event.clone());
            while state.history.len() > self.history_size {
                state.history.pop_front();
            }
            state.clients.clone()
        };
        let mut disconnected = HashSet::new();
        for (id, sender) in clients {
            match sender.try_send(event.clone()) {
                Ok(()) | Err(TrySendError::Full(_)) => {}
                Err(TrySendError::Disconnected(_)) => {
                    disconnected.insert(id);
                }
            }
        }
        if !disconnected.is_empty() {
            let mut state = self.state();
            state.clients.retain(|(id, _)| !disconnected.contains(id));
        }
    }

    pub fn register_client(&self) -> (Receiver<LogEvent>, Vec<LogEvent>) {
        let (sender, receiver) = bounded(CLIENT_QUEUE_SIZE);
        let mut state = self.state();
        let id = state.next_client_id;
        state.next_client_id += 1;
        state.clients.push((id, sender));
        let history = state.history.iter().cloned().collect();
        drop(state);
        (receiver, history)
    }

    fn state(&self) -> MutexGuard<'_, LogHubState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

pub struct LogWorkerConfig {
    pub service: String,
    pub prefix: String,
    pub color_prefix: String,
    pub color_reset: String,
    pub emit_stdout: bool,
}

pub fn log_worker<R: Read>(
    reader: R,
    log_hub: Option<&Arc<LogHub>>,
    stop_event: &Arc<AtomicBool>,
    config: LogWorkerConfig,
) {
    let LogWorkerConfig {
        service,
        prefix,
        color_prefix,
        color_reset,
        emit_stdout,
    } = config;
    let mut reader = BufReader::new(reader);
    let mut buffer = Vec::new();
    let mut aggregator = MultilineAggregator::new(Duration::from_millis(1500));
    loop {
        if stop_event.load(Ordering::SeqCst) {
            break;
        }
        buffer.clear();
        let Ok(bytes) = reader.read_until(b'\n', &mut buffer) else {
            break;
        };
        if bytes == 0 {
            break;
        }
        if buffer.last() == Some(&b'\n') {
            buffer.pop();
            if buffer.last() == Some(&b'\r') {
                buffer.pop();
            }
        }
        let line = strip_ansi_codes(&buffer);
        let now = Instant::now();
        let events = aggregator.push_line(line.as_ref(), now);
        for event in events {
            if let Some(hub) = log_hub {
                hub.publish(&service, &event.line, event.container_ts.as_deref());
            }
            if emit_stdout {
                emit_entries(&prefix, &color_prefix, &color_reset, &event.line);
            }
        }
    }
    if let Some(event) = aggregator.flush() {
        if let Some(hub) = log_hub {
            hub.publish(&service, &event.line, event.container_ts.as_deref());
        }
        if emit_stdout {
            emit_entries(&prefix, &color_prefix, &color_reset, &event.line);
        }
    }
}

fn emit_entries(prefix: &str, color_prefix: &str, color_reset: &str, line: &str) {
    let mut stdout = std::io::stdout();
    for entry in line.split('\n') {
        let _ = writeln!(stdout, "{color_prefix}{prefix}{color_reset} | {entry}");
    }
}

pub fn strip_ansi_codes(input: &[u8]) -> Cow<'_, str> {
    let has_escape = input.iter().any(|byte| *byte == 0x1b || *byte == 0x9b);
    if !has_escape {
        return std::str::from_utf8(input).map_or_else(
            |_| Cow::Owned(String::from_utf8_lossy(input).into_owned()),
            Cow::Borrowed,
        );
    }
    let stripped = if input.iter().any(|byte| *byte == 0x9b) {
        let mut normalized = Vec::with_capacity(input.len() + 8);
        for &byte in input {
            if byte == 0x9b {
                normalized.push(0x1b);
                normalized.push(b'[');
            } else {
                normalized.push(byte);
            }
        }
        strip_ansi_escapes::strip(&normalized)
    } else {
        strip_ansi_escapes::strip(input)
    };
    Cow::Owned(String::from_utf8_lossy(&stripped).into_owned())
}
