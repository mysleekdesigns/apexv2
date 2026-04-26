export interface DashboardOptions {
  windowDays?: number;
}

export interface DashboardCounts {
  used: number;
  helpful: number;
  corrected: number;
  unused: number;
}

export interface DashboardResult extends DashboardCounts {
  windowDays: number;
  episodesScanned: number;
  line: string;
}
