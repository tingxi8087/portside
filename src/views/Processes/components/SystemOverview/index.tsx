import type { SystemOverview as Overview } from "@/services/system";
import { floatingValue } from "@/services/floating";
import type { ReactNode } from "react";
import "./style.less";

function OverviewField({label,children,wide=false}:{label:string;children:ReactNode;wide?:boolean}) {
  return <div className={`system-overview__field${wide?' is-wide':''}`}><dt>{label}</dt><dd>{children}</dd></div>;
}
function uptime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return `${hours >= 24 ? `${Math.floor(hours / 24)} 天 ` : ""}${hours % 24} 小时 ${minutes % 60} 分钟`;
}
function Usage({
  label,
  value,
  detail,
}: {
  label: string;
  value: number | null;
  detail?: string;
}) {
  const valid = value !== null && Number.isFinite(value);
  return (
    <section className="system-usage" aria-label={label}>
      <div className="system-usage__heading">
        <span>{label}</span>
        <strong className="mono">
          {valid ? `${Math.round(value)}%` : "—"}
        </strong>
      </div>
      <progress
        aria-label={`${label}使用率`}
        max={100}
        value={valid ? Math.max(0, Math.min(100, value)) : 0}
      />
      {detail && <p className="muted mono">{detail}</p>}
    </section>
  );
}
export default function SystemOverview({
  overview,
  loading,
  error,
  paused,
}: {
  overview?: Overview | null;
  loading: boolean;
  error: string;
  paused: boolean;
}) {
  if (!overview)
    return (
      <p className="system-overview__status muted" role="status">
        {error
          ? "系统信息暂不可用，请稍后刷新。"
          : loading
            ? "正在读取系统信息…"
            : "系统信息暂不可用。"}
      </p>
    );
  const { stats, info, disk } = overview;
  return (
    <div className="system-overview">
      <Usage label="CPU" value={stats.cpu} />
      <Usage
        label="内存"
        value={stats.memory}
        detail={
          stats.memoryTotal > 0
            ? `已用 ${(stats.memoryUsed / 1e9).toFixed(1)} / ${(stats.memoryTotal / 1e9).toFixed(1)} GB`
            : undefined
        }
      />
      <Usage
        label="启动磁盘"
        value={disk && disk.total > 0 ? disk.used / disk.total * 100 : null}
        detail={disk && disk.total > 0
          ? `已用 ${(disk.used / 1e9).toFixed(1)} / ${(disk.total / 1e9).toFixed(1)} GB`
          : "容量暂不可用"}
      />
      <section className="system-overview__group" aria-label="网络速度">
        <h3>网络</h3>
        <dl className="system-overview__fields">
        <OverviewField label="下载">
          <span className="mono">{floatingValue("download", stats)}</span>
        </OverviewField>
        <OverviewField label="上传">
          <span className="mono">{floatingValue("upload", stats)}</span>
        </OverviewField>
        </dl>
      </section>
      <section className="system-overview__group" aria-label="系统基础信息">
        <h3>系统</h3>
        <dl className="system-overview__fields">
        <OverviewField label="型号">{info.model || "—"}</OverviewField>
        <OverviewField label="芯片">{info.chip || "—"}</OverviewField>
        <OverviewField label="逻辑核心">{info.cores || "—"}</OverviewField>
        <OverviewField label="系统版本">{info.os || "—"}</OverviewField>
        <OverviewField label="已运行" wide>{uptime(overview.uptime)}</OverviewField>
        </dl>
      </section>
    </div>
  );
}
