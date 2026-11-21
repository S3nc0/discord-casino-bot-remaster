import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button, Dialog, RadioGroup, Slider, Switch, Tabs } from '../index.ts';

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open dialog</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        role="alertdialog"
        title="Delete save?"
        description="This cannot be undone."
        actions={
          <>
            <Button variant="text" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => setOpen(false)}>
              Delete
            </Button>
          </>
        }
      />
    </>
  );
}

describe('Keyboard and ARIA checks', () => {
  it('Dialog: moves focus in, traps Tab, closes on Esc and scrim, and restores focus', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(trigger);

    const dialog = screen.getByRole('alertdialog', { name: 'Delete save?' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();

    const keepBtn = screen.getByRole('button', { name: 'Keep it' });
    const deleteBtn = screen.getByRole('button', { name: 'Delete' });
    expect(document.activeElement).toBe(keepBtn);

    await user.tab();
    expect(document.activeElement).toBe(deleteBtn);

    await user.tab();
    expect(document.activeElement).toBe(keepBtn);

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(deleteBtn);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await user.click(trigger);
    const scrim = screen.getByRole('alertdialog').parentElement!;
    await user.click(scrim);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('Tabs: supports roving tabindex, ArrowLeft/ArrowRight/Home/End, and Enter/Space selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Tabs
        label="Sections"
        onChange={onChange}
        tabs={[
          { id: 'a', label: 'Seeds', panel: <div>Seeds panel</div> },
          { id: 'b', label: 'Tools', panel: <div>Tools panel</div> },
          { id: 'c', label: 'Badges', panel: <div>Badges panel</div> },
        ]}
      />,
    );

    const seeds = screen.getByRole('tab', { name: 'Seeds' });
    const tools = screen.getByRole('tab', { name: 'Tools' });
    const badges = screen.getByRole('tab', { name: 'Badges' });

    expect(seeds.tabIndex).toBe(0);
    expect(tools.tabIndex).toBe(-1);
    expect(badges.tabIndex).toBe(-1);

    seeds.focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(tools);
    expect(tools.tabIndex).toBe(0);
    expect(seeds.tabIndex).toBe(-1);
    expect(seeds.getAttribute('aria-selected')).toBe('true');

    await user.keyboard('{Enter}');
    expect(tools.getAttribute('aria-selected')).toBe('true');
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.getByRole('tabpanel').textContent).toBe('Tools panel');

    await user.keyboard('{End}');
    expect(document.activeElement).toBe(badges);
    await user.keyboard(' ');
    expect(badges.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('Badges panel');

    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(seeds);
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(badges);
  });

  it('Switch: toggles aria-checked and On/Off label via keyboard Space and click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch label="Music" onChange={onChange} />);

    const sw = screen.getByRole('switch', { name: /Music/ });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Off')).toBeTruthy();

    sw.focus();
    await user.keyboard(' ');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('On')).toBeTruthy();
    expect(onChange).toHaveBeenCalledWith(true);

    await user.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Off')).toBeTruthy();
  });

  it('Radio: navigates and selects inside RadioGroup fieldset', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RadioGroup
        legend="Speed"
        name="speed"
        defaultValue="normal"
        onChange={onChange}
        options={[
          { value: 'slow', label: 'Slow' },
          { value: 'normal', label: 'Normal' },
          { value: 'fast', label: 'Fast' },
        ]}
      />,
    );

    const slow = screen.getByRole('radio', { name: 'Slow' }) as HTMLInputElement;
    const normal = screen.getByRole('radio', { name: 'Normal' }) as HTMLInputElement;
    const fast = screen.getByRole('radio', { name: 'Fast' }) as HTMLInputElement;

    expect(normal.checked).toBe(true);
    normal.focus();
    await user.keyboard('{ArrowDown}');
    expect(fast.checked).toBe(true);
    expect(onChange).toHaveBeenCalledWith('fast');

    await user.click(slow);
    expect(slow.checked).toBe(true);
    expect(onChange).toHaveBeenCalledWith('slow');
  });

  it('Slider: exposes range ARIA attributes and updates value + --val on change', () => {
    const onChange = vi.fn();
    render(
      <Slider
        label="Bet size"
        min={10}
        max={110}
        step={10}
        defaultValue={60}
        formatValue={(v) => `${v} P`}
        onChange={onChange}
      />,
    );

    const slider = screen.getByRole('slider', { name: 'Bet size' }) as HTMLInputElement;
    expect(slider.getAttribute('aria-valuemin')).toBe('10');
    expect(slider.getAttribute('aria-valuemax')).toBe('110');
    expect(slider.getAttribute('aria-valuenow')).toBe('60');
    expect(slider.getAttribute('aria-valuetext')).toBe('60 P');
    expect(slider.style.getPropertyValue('--val')).toBe('50%');

    fireEvent.change(slider, { target: { value: '85' } });
    expect(onChange).toHaveBeenCalledWith(85);
    expect(slider.getAttribute('aria-valuenow')).toBe('85');
    expect(slider.getAttribute('aria-valuetext')).toBe('85 P');
    expect(slider.style.getPropertyValue('--val')).toBe('75%');
  });
});
