use std::time::{Duration, Instant};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Decision {
    StartNew,
    NoOpinion,
}

#[derive(Clone, Copy, Debug)]
pub struct Ruling {
    pub decision: Decision,
    pub complete: bool,
}

pub struct AggregatedEvent {
    pub line: String,
    pub container_ts: Option<String>,
}

pub struct LineView<'a> {
    pub content: &'a str,
}

impl<'a> LineView<'a> {
    pub const fn new(content: &'a str) -> Self {
        Self { content }
    }
}

struct Vote {
    decision: Decision,
    complete: bool,
}

impl Vote {
    const fn start(complete: bool) -> Self {
        Self {
            decision: Decision::StartNew,
            complete,
        }
    }
}

trait Classifier: Send + Sync {
    fn classify(&self, view: &LineView) -> Option<Vote>;
}

pub struct Router {
    start_classifiers: Vec<Box<dyn Classifier>>,
}

impl Router {
    pub fn new() -> Self {
        Self {
            start_classifiers: vec![Box::new(JsonClassifier), Box::new(TokenSignalClassifier)],
        }
    }

    pub fn classify(&self, view: &LineView) -> Ruling {
        for classifier in &self.start_classifiers {
            if let Some(vote) = classifier.classify(view) {
                return Ruling {
                    decision: vote.decision,
                    complete: vote.complete,
                };
            }
        }
        Ruling {
            decision: Decision::NoOpinion,
            complete: false,
        }
    }
}

pub struct MultilineAggregator {
    router: Router,
    buffer: String,
    last_ingest: Option<Instant>,
    max_gap: Duration,
    current_container_ts: Option<String>,
    last_outer_ts: Option<i64>,
}

impl MultilineAggregator {
    pub fn new(max_gap: Duration) -> Self {
        Self {
            router: Router::new(),
            buffer: String::new(),
            last_ingest: None,
            max_gap,
            current_container_ts: None,
            last_outer_ts: None,
        }
    }

    pub fn push_line(&mut self, line: &str, now: Instant) -> Vec<AggregatedEvent> {
        let mut flushed = Vec::new();
        let (container_ts, content, current_outer_ts) = extract_outer_timestamp(line);
        let arrival_gap_exceeded = self
            .last_ingest
            .is_some_and(|last| now.duration_since(last) > self.max_gap);
        let gap_exceeded = match (self.last_outer_ts, current_outer_ts) {
            (Some(prev), Some(curr)) if curr >= prev => {
                let delta_ms = curr - prev;
                let max_gap_ms = i64::try_from(self.max_gap.as_millis()).unwrap_or(i64::MAX);
                delta_ms > max_gap_ms
            }
            _ => arrival_gap_exceeded,
        };

        let view = LineView::new(content);
        let ruling = self.router.classify(&view);
        let is_start = ruling.decision == Decision::StartNew;

        if gap_exceeded || is_start {
            self.flush_current(&mut flushed);
            self.start_new_entry(content, container_ts);
            if ruling.complete {
                self.flush_current(&mut flushed);
            }
            self.last_ingest = Some(now);
            if let Some(ts) = current_outer_ts {
                self.last_outer_ts = Some(ts);
            }
            return flushed;
        }

        if self.buffer.is_empty() {
            self.start_new_entry(content, container_ts);
        } else {
            self.append_line(content);
        }
        self.last_ingest = Some(now);
        if let Some(ts) = current_outer_ts {
            self.last_outer_ts = Some(ts);
        }
        flushed
    }

    pub fn flush(&mut self) -> Option<AggregatedEvent> {
        self.take_event()
    }

    fn take_event(&mut self) -> Option<AggregatedEvent> {
        if self.buffer.is_empty() {
            None
        } else {
            Some(AggregatedEvent {
                line: std::mem::take(&mut self.buffer),
                container_ts: self.current_container_ts.take(),
            })
        }
    }

    fn flush_current(&mut self, flushed: &mut Vec<AggregatedEvent>) {
        if let Some(event) = self.take_event() {
            flushed.push(event);
        }
    }

    fn start_new_entry(&mut self, line: &str, container_ts: Option<&str>) {
        self.current_container_ts = container_ts.map(ToString::to_string);
        self.buffer.push_str(line);
    }

    fn append_line(&mut self, line: &str) {
        if !self.buffer.is_empty() {
            self.buffer.push('\n');
        }
        self.buffer.push_str(line);
    }
}

struct JsonClassifier;

impl Classifier for JsonClassifier {
    fn classify(&self, view: &LineView) -> Option<Vote> {
        let candidate = extract_json_candidate(view.content)?;
        if serde_json::from_str::<serde_json::Value>(candidate).is_ok() {
            return Some(Vote::start(true));
        }
        None
    }
}

struct TokenSignalClassifier;

impl Classifier for TokenSignalClassifier {
    fn classify(&self, view: &LineView) -> Option<Vote> {
        if has_start_signal(view.content) {
            return Some(Vote::start(false));
        }
        None
    }
}

fn extract_json_candidate(value: &str) -> Option<&str> {
    let candidate = value.trim();
    let bytes = candidate.as_bytes();
    let start = *bytes.first()?;
    let end = *bytes.last()?;
    if (start == b'{' && end == b'}') || (start == b'[' && end == b']') {
        Some(candidate)
    } else {
        None
    }
}

fn extract_outer_timestamp(line: &str) -> (Option<&str>, &str, Option<i64>) {
    let mut parts = line.splitn(2, char::is_whitespace);
    let ts = parts.next().unwrap_or("");
    if let Some(rest) = parts.next() {
        if let Some(parsed) = parse_rfc3339_to_epoch_millis(ts) {
            return (Some(ts), rest, Some(parsed));
        }
        return (None, line, None);
    }
    if let Some(parsed) = parse_rfc3339_to_epoch_millis(line) {
        return (Some(line), "", Some(parsed));
    }
    (None, line, None)
}

fn has_start_signal(line: &str) -> bool {
    let tokens: Vec<&str> = line.split_whitespace().take(LEADING_TOKEN_LIMIT).collect();
    if tokens.is_empty() {
        return false;
    }
    if tokens.iter().any(|token| token_contains_datetime(token)) {
        return true;
    }
    let mut previous = None;
    for token in &tokens {
        if let Some(prev) = previous {
            if token_contains_date(prev) && token_contains_time(token) {
                return true;
            }
        }
        previous = Some(*token);
    }
    tokens.iter().any(|token| token_has_severity(token))
}

fn token_has_severity(token: &str) -> bool {
    let bytes = token.as_bytes();
    let mut idx = 0;
    while byte_at(bytes, idx).is_some() {
        while let Some(byte) = byte_at(bytes, idx) {
            if byte.is_ascii_alphabetic() {
                break;
            }
            idx += 1;
        }
        let start = idx;
        while let Some(byte) = byte_at(bytes, idx) {
            if !byte.is_ascii_alphabetic() {
                break;
            }
            idx += 1;
        }
        if start < idx && token.get(start..idx).is_some_and(is_level) {
            return true;
        }
    }
    false
}

fn token_contains_datetime(token: &str) -> bool {
    let bytes = token.as_bytes();
    let mut idx = 0;
    while idx + 10 < bytes.len() {
        if let Some(end) = match_date_at(bytes, idx) {
            if matches!(byte_at(bytes, end), Some(b'T' | b't'))
                && match_time_at(bytes, end + 1).is_some()
            {
                return true;
            }
        }
        idx += 1;
    }
    false
}

fn token_contains_date(token: &str) -> bool {
    let bytes = token.as_bytes();
    let mut idx = 0;
    while idx + 9 < bytes.len() {
        if match_date_at(bytes, idx).is_some() {
            return true;
        }
        idx += 1;
    }
    false
}

fn token_contains_time(token: &str) -> bool {
    let bytes = token.as_bytes();
    let mut idx = 0;
    while idx + 7 < bytes.len() {
        if match_time_at(bytes, idx).is_some() {
            return true;
        }
        idx += 1;
    }
    false
}

fn match_date_at(bytes: &[u8], idx: usize) -> Option<usize> {
    if idx + 9 >= bytes.len() {
        return None;
    }
    if !is_digit(bytes, idx)
        || !is_digit(bytes, idx + 1)
        || !is_digit(bytes, idx + 2)
        || !is_digit(bytes, idx + 3)
    {
        return None;
    }
    let sep = byte_at(bytes, idx + 4)?;
    if sep != b'-' && sep != b'/' {
        return None;
    }
    if !is_digit(bytes, idx + 5) || !is_digit(bytes, idx + 6) {
        return None;
    }
    let sep2 = byte_at(bytes, idx + 7)?;
    if sep2 != b'-' && sep2 != b'/' {
        return None;
    }
    if !is_digit(bytes, idx + 8) || !is_digit(bytes, idx + 9) {
        return None;
    }
    Some(idx + 10)
}

fn match_time_at(bytes: &[u8], idx: usize) -> Option<usize> {
    if idx + 7 >= bytes.len() {
        return None;
    }
    if !is_digit(bytes, idx)
        || !is_digit(bytes, idx + 1)
        || byte_at(bytes, idx + 2)? != b':'
        || !is_digit(bytes, idx + 3)
        || !is_digit(bytes, idx + 4)
        || byte_at(bytes, idx + 5)? != b':'
        || !is_digit(bytes, idx + 6)
        || !is_digit(bytes, idx + 7)
    {
        return None;
    }
    let mut end = idx + 8;
    if matches!(byte_at(bytes, end), Some(b'.' | b',')) {
        end += 1;
        let start = end;
        while byte_at(bytes, end).is_some_and(|byte| byte.is_ascii_digit()) {
            end += 1;
        }
        if start == end {
            return None;
        }
    }
    if let Some(byte) = byte_at(bytes, end) {
        match byte {
            b'Z' | b'z' => end += 1,
            b'+' | b'-' => {
                if end + 5 < bytes.len()
                    && is_digit(bytes, end + 1)
                    && is_digit(bytes, end + 2)
                    && byte_at(bytes, end + 3)? == b':'
                    && is_digit(bytes, end + 4)
                    && is_digit(bytes, end + 5)
                {
                    end += 6;
                }
            }
            _ => {}
        }
    }
    Some(end)
}

fn is_digit(bytes: &[u8], idx: usize) -> bool {
    byte_at(bytes, idx).is_some_and(|byte| byte.is_ascii_digit())
}

fn byte_at(bytes: &[u8], idx: usize) -> Option<u8> {
    bytes.get(idx).copied()
}

fn parse_rfc3339_to_epoch_millis(value: &str) -> Option<i64> {
    let parsed = OffsetDateTime::parse(value, &Rfc3339).ok()?;
    let seconds = parsed.unix_timestamp();
    let millis = i64::from(parsed.millisecond());
    Some(seconds.saturating_mul(1000).saturating_add(millis))
}

fn is_level(value: &str) -> bool {
    LEVELS.iter().any(|level| value.eq_ignore_ascii_case(level))
}

const LEADING_TOKEN_LIMIT: usize = 5;
const LEVELS: [&str; 9] = [
    "TRACE", "DEBUG", "INFO", "WARN", "WARNING", "ERROR", "FATAL", "CRITICAL", "PANIC",
];
