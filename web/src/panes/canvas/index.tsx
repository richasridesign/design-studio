import { useCallback, useEffect, useRef, useState } from 'react';
import { getJson, postJson, useStore } from '../../store';
import { Icon } from '../../Icon';
import { Empty, PrototypeArt } from '../Empty';
import type { Board as BoardData, CanvasStatus } from '../../../../shared/canvas';
import { Board, type FlowRef } from './Board';
import '../../styles/canvas.css';

// The Canvas tab: the prototype app's screens as live frames on a board. Select mode picks an element inside a frame
// and the inspector edits its source (text and attributes) through canvas-core; Vite then updates every frame.
// In Select and Hand modes a shield covers every frame, so the board gets every wheel, pinch and drag; a click on the
// shield asks the frame which element sits under that point. Only Interact mode hands the pointer to the app.

const BUSY = ['creating', 'installing', 'starting'];

export function Canvas() {
  const chat = useStore((s) => s.session.id);
  const [status, setStatus] = useState<CanvasStatus | null>(null);
  const [board, setBoard] = useState<BoardData | null>(null);
  const [flow, setFlow] = useState<FlowRef | null>(null);
  const [error, setError] = useState('');
  const chatRef = useRef(chat);
  chatRef.current = chat;

  // A flow chat opens its flow's board, any other chat the project's main board.
  const load = useCallback(async () => {
    const asked = chatRef.current;
    try {
      const r = await getJson<{ status: CanvasStatus; board: BoardData; flow: FlowRef | null }>('/api/canvas');
      if (asked !== chatRef.current) return;
      setStatus(r.status);
      setFlow(r.flow);
      setBoard((b) => b ?? r.board);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { setBoard(null); setStatus(null); void load(); }, [chat, load]);
  useEffect(() => {
    if (!status || !BUSY.includes(status.state)) return;
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, [status, load]);
  // A made app starts by itself when the tab opens.
  useEffect(() => {
    if (status?.state === 'stopped') postJson<{ status: CanvasStatus }>('/api/canvas/start', {}).then((r) => setStatus(r.status), (e) => setError(e.message));
  }, [status?.state]);

  const create = () => postJson<{ status: CanvasStatus }>('/api/canvas/create', {}).then((r) => setStatus({ ...r.status, state: 'creating' }), (e) => setError(e.message));

  if (error && !status) return <Empty art={<PrototypeArt />} title="The canvas could not load" text={error} action={{ label: 'Try again', onClick: load }} />;
  if (!status || !board) return null;
  if (status.state === 'none') {
    return (
      <Empty
        art={<PrototypeArt />}
        title="No prototype app yet"
        text={status.hasProfile
          ? 'Design Studio makes a React app in this project with your design system tokens and base components. Every screen on the canvas is that real app.'
          : 'Design Studio makes a React app in this project with base components. There is no design system profile yet, so it starts with neutral colours; Refresh tokens applies the profile later.'}
        action={{ label: 'Create prototype app', onClick: create }}
      />
    );
  }
  if (BUSY.includes(status.state) || status.state === 'stopped') {
    return <div className="cv-wait" role="status"><Icon name="loading" spin /> {status.step ?? 'Starting the app'}</div>;
  }
  if (status.state === 'failed' || !status.url) {
    return <Empty art={<PrototypeArt />} title="The app did not start" text={status.error ?? 'Unknown error'} action={{ label: 'Try again', onClick: () => postJson('/api/canvas/start', {}).then(load) }} />;
  }
  return <Board key={chat} url={status.url} board={board} setBoard={setBoard} flow={flow} />;
}
