export interface ServiceInfo {
  name: string;
  endpoints?: string[];
  endpoint?: string | null;
  exposed?: boolean;
}

export interface LogEvent {
  seq: number;
  service: string;
  container_ts?: string | null;
  line: string;
}

export type EntityId =
  | { kind: "workload"; name: string; instance?: string | null }
  | { kind: "external"; ip: string; dns_name?: string | null }
  | { kind: "host"; name: string }
  | { kind: "unknown" };

export type Transport =
  | { kind: "tcp" }
  | { kind: "udp" }
  | { kind: "other"; code: number };

export type EdgeKey =
  | {
      kind: "flow";
      from: EntityId;
      to: EntityId;
      transport: Transport;
      port: number;
    }
  | {
      kind: "http";
      from: EntityId;
      to: EntityId;
      method: string;
      route: string;
    }
  | {
      kind: "grpc";
      from: EntityId;
      to: EntityId;
      service: string;
      method: string;
    };

export interface EdgeStats {
  count: number;
  bytes_in: number;
  bytes_out: number;
  errors: number;
  p50_ms?: number | null;
  p95_ms?: number | null;
  visibility: "l4_flow" | "l7_envelope" | "l7_semantics";
}

export interface TrafficEdge {
  key: EdgeKey;
  stats: EdgeStats;
  last_seen_ms: number;
}

export interface PanelState {
  id: string;
  title: string;
  filter: string[] | null;
  include: string[];
  exclude: string[];
  autoScroll: boolean;
  logs: LogEvent[];
  delay: number;
}

export interface PanelConfig {
  services: string[] | null;
  include: string[];
  exclude: string[];
  follow: boolean;
}
