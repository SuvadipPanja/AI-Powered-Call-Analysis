import { render, screen, fireEvent } from '@testing-library/react';
import {
  EmptyState,
  PageLoading,
  PageError,
  SkipLink,
  Segmented,
  Spinner,
  ResponsiveTableWrap,
} from './index';

describe('UI primitives', () => {
  it('EmptyState uses alert role for error variant', () => {
    render(<EmptyState variant="error" title="Failed" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Failed');
  });

  it('EmptyState uses status role by default', () => {
    render(<EmptyState title="No data" />);
    expect(screen.getByRole('status')).toHaveTextContent('No data');
  });

  it('PageLoading exposes status message', () => {
    render(<PageLoading message="Loading dashboard…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading dashboard…');
  });

  it('PageError shows message and retry action', () => {
    const onRetry = jest.fn();
    render(<PageError message="Network error" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('SkipLink targets main content landmark', () => {
    render(<SkipLink />);
    expect(screen.getByRole('link', { name: /skip to main content/i })).toHaveAttribute('href', '#main-content');
  });

  it('Segmented supports arrow-key navigation', () => {
    const onChange = jest.fn();
    render(
      <Segmented
        ariaLabel="Range"
        value="a"
        onChange={onChange}
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
      />,
    );
    const tabs = screen.getAllByRole('tab');
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('Spinner exposes accessible loading label', () => {
    render(<Spinner label="Loading table" />);
    expect(screen.getByRole('status', { name: 'Loading table' })).toBeInTheDocument();
  });

  it('ResponsiveTableWrap can expose a labelled region', () => {
    render(
      <ResponsiveTableWrap label="Agent scores">
        <table><tbody><tr><td>Row</td></tr></tbody></table>
      </ResponsiveTableWrap>,
    );
    expect(screen.getByRole('region', { name: 'Agent scores' })).toBeInTheDocument();
  });
});
