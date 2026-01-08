use crossbeam_channel::{bounded, Receiver, Sender, TrySendError};
use std::borrow::Cow;
use std::collections::{HashSet, VecDeque};
use std::io::{BufRead, BufReader, Read};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::domain::LogEvent;
use crate::support::constants::CLIENT_QUEUE_SIZE;
use crate::support::multiline::MultilineAggregator;

struct LogHubState {
    history: VecDeque<LogEvent>,
    clients: Vec<(usize, Sender<LogEvent>)>,
    next_client_id: usize,
}

pub(crate) struct LogHub {
    state: Mutex<LogHubState>,
    seq: AtomicU64,
    history_size: usize,
}

impl LogHub {
    pub(crate) fn new(history_size: usize) -> Self {
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

    pub(crate) fn publish(&self, service: &str, line: &str, container_ts: Option<&str>) {
        let seq = self.seq.fetch_add(1, Ordering::SeqCst) + 1;
        let event = LogEvent {
            seq,
            service: if service.is_empty() {
                "unknown".to_string()
            } else {
                service.to_string()
            },
            container_ts: container_ts.map(|value| value.to_string()),
            line: line.to_string(),
        };
        let clients = {
            let mut state = self.state.lock().unwrap();
            state.history.push_back(event.clone());
            while state.history.len() > self.history_size {
                state.history.pop_front();
            }
            state.clients.clone()
        };
        let mut disconnected = HashSet::new();
        for (id, sender) in clients {
            match sender.try_send(event.clone()) {
                Ok(()) => {}
                Err(TrySendError::Full(_)) => {}
                Err(TrySendError::Disconnected(_)) => {
                    disconnected.insert(id);
                }
            }
        }
        if !disconnected.is_empty() {
            let mut state = self.state.lock().unwrap();
            state.clients.retain(|(id, _)| !disconnected.contains(id));
        }
    }

    pub(crate) fn register_client(&self) -> (Receiver<LogEvent>, Vec<LogEvent>) {
        let (sender, receiver) = bounded(CLIENT_QUEUE_SIZE);
        let mut state = self.state.lock().unwrap();
        let id = state.next_client_id;
        state.next_client_id += 1;
        state.clients.push((id, sender));
        let history = state.history.iter().cloned().collect();
        (receiver, history)
    }
}

pub(crate) fn log_worker<R: Read>(
    reader: R,
    log_hub: Option<Arc<LogHub>>,
    stop_event: Arc<AtomicBool>,
    service: &str,
    prefix: &str,
    color_prefix: &str,
    color_reset: &str,
    emit_stdout: bool,
) {
    let mut reader = BufReader::new(reader);
    let mut buffer = Vec::new();
    let mut aggregator = MultilineAggregator::new(Duration::from_millis(1500));
    loop {
        if stop_event.load(Ordering::SeqCst) {
            break;
        }
        buffer.clear();
        let bytes = match reader.read_until(b'\n', &mut buffer) {
            Ok(bytes) => bytes,
            Err(_) => break,
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
            if let Some(hub) = log_hub.as_ref() {
                hub.publish(service, &event.line, event.container_ts.as_deref());
            }
            if emit_stdout {
                for entry in event.line.split('\n') {
                    println!("{}{}{} | {}", color_prefix, prefix, color_reset, entry);
                }
            }
        }
    }
    if let Some(event) = aggregator.flush() {
        if let Some(hub) = log_hub.as_ref() {
            hub.publish(service, &event.line, event.container_ts.as_deref());
        }
        if emit_stdout {
            for entry in event.line.split('\n') {
                println!("{}{}{} | {}", color_prefix, prefix, color_reset, entry);
            }
        }
    }
}

pub(crate) fn strip_ansi_codes(input: &[u8]) -> Cow<'_, str> {
    let has_escape = input.iter().any(|byte| *byte == 0x1b || *byte == 0x9b);
    if !has_escape {
        return match std::str::from_utf8(input) {
            Ok(value) => Cow::Borrowed(value),
            Err(_) => Cow::Owned(String::from_utf8_lossy(input).into_owned()),
        };
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
