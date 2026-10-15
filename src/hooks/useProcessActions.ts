import { useState } from 'react';
import { App } from 'paper-ink';
import { terminateProcess, type SystemProcess } from '@/services/system';
import { recordProcessExit, refreshSystem } from '@/hooks/useSystemMonitor';
export function useProcessActions() {
  const { message, modal } = App.useApp();
  const [ending, setEnding] = useState<number>();
  const end = async (process: SystemProcess, force = false): Promise<void> => {
    setEnding(process.pid);
    try {
      const result = await terminateProcess(process, force);
      if (result.exited) recordProcessExit(process.identity);
      await refreshSystem();
      if (result.exited) message.success(`${process.name} 已退出`);
      else if (!force) modal.confirm({ title: `${process.name} 尚未退出`, content: '正常退出信号已发送。是否强制结束？未保存的数据可能丢失。', okText: '强制结束', cancelText: '继续等待', onOk: () => end(process, true) });
      else message.warning('已发送强制结束信号，进程尚未退出，请稍后刷新。');
    } catch (error) { message.error(String(error)); }
    finally { setEnding(undefined); }
  };
  const requestEnd = (process: SystemProcess) => {
    if (ending !== undefined) return;
    if (!process.mine || process.app === 'macOS') modal.confirm({ title: `结束 ${process.name}？`, content: '这会结束真实进程并关闭其所有端口，可能影响其他应用或系统服务。', okText: '结束进程', cancelText: '取消', onOk: () => end(process) });
    else void end(process);
  };
  return { ending, requestEnd };
}
