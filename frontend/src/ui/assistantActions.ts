import { useLab } from '../store/lab';

/** put generated code into the board's firmware and show the Code tab */
export function setFirmwareHelper(compId: string, code: string): void {
  const s = useLab.getState();
  s.setFirmware(compId, { kind: 'sketch', source: code });
  s.set({ bottomTab: 'code', mcuTarget: compId, panels: { ...s.panels, bottom: true } });
  s.checkFirmware(compId);
}
