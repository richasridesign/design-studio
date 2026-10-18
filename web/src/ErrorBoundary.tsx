import { Component, type ReactNode } from 'react';

type Props = { label: string; children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    const { label, children } = this.props;
    if (!error) return children;
    return (
      <div className="error-panel">
        <b>This {label} hit an error</b>
        <code>{error.message}</code>
        <button onClick={this.reset}>Reload {label}</button>
      </div>
    );
  }
}
