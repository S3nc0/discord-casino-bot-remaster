import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  Avatar,
  Banner,
  Button,
  Card,
  CheckIcon,
  Checkbox,
  CheckboxGroup,
  Chip,
  ChipGroup,
  Dialog,
  FAB,
  IconButton,
  InfoIcon,
  List,
  ListItem,
  NavigationBar,
  Progress,
  Radio,
  RadioGroup,
  ScrollFade,
  Slider,
  Snackbar,
  Switch,
  Tabs,
  Tag,
  TextField,
} from '../index.ts';

describe('Bitbloom components render suite', () => {
  it('renders Banner with icon, bold title, and status/alert role', () => {
    const { rerender } = render(
      <Banner variant="info" title="New season">
        Spring seeds are in the shop.
      </Banner>,
    );
    const statusBanner = screen.getByRole('status');
    expect(statusBanner.className).toContain('bb-banner--info');
    expect(screen.getByText('New season').tagName).toBe('STRONG');

    rerender(
      <Banner variant="error" title="Couldn't connect">
        Check your internet, then try again.
      </Banner>,
    );
    const alertBanner = screen.getByRole('alert');
    expect(alertBanner.className).toContain('bb-banner--error');
  });

  it('renders Button variants and handles clicks', () => {
    const onClick = vi.fn();
    render(
      <>
        <Button onClick={onClick} icon={<CheckIcon />}>
          Plant seeds
        </Button>
        <Button variant="tonal">Invite friends</Button>
        <Button variant="outlined">Preview</Button>
        <Button variant="text">Skip</Button>
        <Button variant="danger" disabled>
          Delete save
        </Button>
      </>,
    );

    const primary = screen.getByRole('button', { name: 'Plant seeds' });
    expect(primary.className).toContain('bb-btn');
    fireEvent.click(primary);
    expect(onClick).toHaveBeenCalledTimes(1);

    expect(screen.getByRole('button', { name: 'Invite friends' }).className).toContain(
      'bb-btn--tonal',
    );
    expect(screen.getByRole('button', { name: 'Preview' }).className).toContain('bb-btn--outlined');
    expect(screen.getByRole('button', { name: 'Skip' }).className).toContain('bb-btn--text');
    const danger = screen.getByRole('button', { name: 'Delete save' });
    expect(danger.className).toContain('bb-btn--danger');
    expect((danger as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders Card variants with title, meta, media, and actions', () => {
    render(
      <>
        <Card
          variant="elevated"
          title="Mossy Cottage"
          meta="Day 42"
          media={<svg aria-label="Cottage art" />}
          actions={<Button variant="text">Open</Button>}
        >
          Saved in cloud.
        </Card>
        <Card variant="filled" title="Filled Card" />
        <Card variant="outlined" title="Outlined Card" />
      </>,
    );

    expect(screen.getByText('Mossy Cottage').className).toContain('bb-card__title');
    expect(screen.getByText('Day 42').className).toContain('bb-card__meta');
    expect(screen.getByText('Saved in cloud.')).toBeTruthy();
    expect(screen.getByText('Filled Card').closest('.bb-card')?.className).toContain(
      'bb-card--filled',
    );
    expect(screen.getByText('Outlined Card').closest('.bb-card')?.className).toContain(
      'bb-card--outlined',
    );
  });

  it('renders Checkbox and CheckboxGroup with visible labels', () => {
    render(
      <CheckboxGroup legend="Notifications">
        <Checkbox label="Daily reminder" defaultChecked />
        <Checkbox label="Error alert" error />
      </CheckboxGroup>,
    );

    expect(screen.getByRole('group', { name: 'Notifications' })).toBeTruthy();
    const daily = screen.getByRole('checkbox', { name: 'Daily reminder' }) as HTMLInputElement;
    expect(daily.checked).toBe(true);
    expect(
      screen.getByRole('checkbox', { name: 'Error alert' }).closest('label')?.className,
    ).toContain('bb-check--error');
  });

  it('renders Chip with aria-pressed and automatic check icon when selected', () => {
    render(
      <ChipGroup label="Filter items">
        <Chip selected>Seeds</Chip>
        <Chip selected={false}>Tools</Chip>
      </ChipGroup>,
    );

    const group = screen.getByRole('group', { name: 'Filter items' });
    expect(group.className).toContain('bb-chips');

    const seeds = screen.getByRole('button', { name: 'Seeds' });
    expect(seeds.getAttribute('aria-pressed')).toBe('true');
    expect(seeds.querySelector('svg')).not.toBeNull();

    const tools = screen.getByRole('button', { name: 'Tools' });
    expect(tools.getAttribute('aria-pressed')).toBe('false');
    expect(tools.querySelector('svg')).toBeNull();
  });

  it('renders Dialog when open and hides when closed', () => {
    const { rerender } = render(
      <Dialog
        open={false}
        onClose={() => {}}
        title="Delete this save?"
        description="Mossy Cottage will be gone."
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(
      <Dialog
        open={true}
        onClose={() => {}}
        role="alertdialog"
        icon={<InfoIcon />}
        title="Delete this save?"
        description="Mossy Cottage will be gone."
        actions={<Button variant="danger">Delete</Button>}
      />,
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this save?' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('Mossy Cottage will be gone.')).toBeTruthy();
  });

  it('renders FAB in compact and extended forms', () => {
    render(
      <>
        <FAB icon={<CheckIcon />} label="Plant" />
        <FAB variant="secondary" icon={<CheckIcon />} label="New quest" extended />
      </>,
    );

    const compact = screen.getByRole('button', { name: 'Plant' });
    expect(compact.className).toContain('bb-fab');
    const extended = screen.getByRole('button', { name: 'New quest' });
    expect(extended.className).toContain('bb-fab--secondary');
    expect(extended.textContent).toContain('New quest');
  });

  it('renders IconButton variants with required aria-label and pressed state', () => {
    render(
      <>
        <IconButton label="Close" icon={<InfoIcon />} />
        <IconButton variant="filled" label="Favorite" pressed icon={<CheckIcon />} />
      </>,
    );

    const closeBtn = screen.getByRole('button', { name: 'Close' });
    expect(closeBtn.className).toContain('bb-icon-btn');
    const favBtn = screen.getByRole('button', { name: 'Favorite' });
    expect(favBtn.className).toContain('bb-icon-btn--filled');
    expect(favBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders List, ListItem, and Avatar', () => {
    const onSelect = vi.fn();
    render(
      <List selectable label="Players">
        <ListItem
          headline="Clover"
          supportingText="Level 12"
          leading={
            <Avatar>
              <svg aria-label="Clover avatar" />
            </Avatar>
          }
          trailing="1,200 P"
          selected
          onSelect={onSelect}
        />
      </List>,
    );

    const option = screen.getByRole('option', { selected: true });
    expect(option.textContent).toContain('Clover');
    expect(option.textContent).toContain('Level 12');
    expect(option.textContent).toContain('1,200 P');
    fireEvent.keyDown(option, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('renders NavigationBar with visible labels, aria-current, and badges', () => {
    const onSelect = vi.fn();
    render(
      <NavigationBar
        activeId="home"
        onSelect={onSelect}
        items={[
          { id: 'home', label: 'Home', icon: <InfoIcon /> },
          { id: 'bag', label: 'Inventory', icon: <InfoIcon />, badge: 120 },
          { id: 'friends', label: 'Friends', icon: <InfoIcon />, badge: 'dot' },
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('99+')).toBeTruthy();
    expect(screen.getByLabelText('New')).toBeTruthy();
  });

  it('renders Progress in determinate, success, and indeterminate modes', () => {
    render(
      <>
        <Progress label="Growing sunflowers" value={45} />
        <Progress
          label="Quest complete"
          value={10}
          max={10}
          valueLabel="10 / 10"
          variant="success"
        />
        <Progress label="Saving" />
      </>,
    );

    const det = screen.getByRole('progressbar', { name: 'Growing sunflowers' });
    expect(det.getAttribute('aria-valuenow')).toBe('45');
    expect(screen.getByText('45%')).toBeTruthy();

    const succ = screen.getByRole('progressbar', { name: 'Quest complete' });
    expect(succ.className).toContain('bb-progress--success');
    expect(screen.getByText('10 / 10')).toBeTruthy();

    const indet = screen.getByRole('progressbar', { name: 'Saving' });
    expect(indet.className).toContain('bb-progress--indeterminate');
    expect(indet.hasAttribute('aria-valuenow')).toBe(false);
  });

  it('renders Radio and RadioGroup with legend and options', () => {
    render(
      <RadioGroup legend="Difficulty" name="diff" defaultValue="normal">
        <Radio value="cozy" label="Cozy" />
        <Radio value="normal" label="Normal (Recommended)" />
      </RadioGroup>,
    );

    expect(screen.getByRole('group', { name: 'Difficulty' })).toBeTruthy();
    const normal = screen.getByRole('radio', { name: 'Normal (Recommended)' }) as HTMLInputElement;
    expect(normal.checked).toBe(true);
  });

  it('renders Slider with visible label, readout, and --val CSS custom property', () => {
    render(<Slider label="Volume" defaultValue={65} />);
    const slider = screen.getByRole('slider', { name: 'Volume' }) as HTMLInputElement;
    expect(slider.value).toBe('65');
    expect(slider.style.getPropertyValue('--val')).toBe('65%');
    expect(screen.getByText('65')).toBeTruthy();
  });

  it('renders Snackbar with message, action, and dismiss', () => {
    const onAction = vi.fn();
    render(<Snackbar message="Harvested 12 sunflowers" actionLabel="Undo" onAction={onAction} />);
    expect(screen.getByRole('status').textContent).toContain('Harvested 12 sunflowers');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('renders Switch with role="switch" and caller-provided state labels', () => {
    render(<Switch label="Sound effects" defaultChecked onLabel="オン" offLabel="オフ" />);
    const sw = screen.getByRole('switch', { name: /Sound effects/ });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('オン')).toBeTruthy();
  });

  it('renders Tabs with tablist, tabs, and active tabpanel', () => {
    render(
      <Tabs
        label="Inventory"
        tabs={[
          { id: 'seeds', label: 'Seeds', panel: <div>Seed list</div> },
          { id: 'tools', label: 'Tools', panel: <div>Tool list</div> },
        ]}
      />,
    );

    expect(screen.getByRole('tablist', { name: 'Inventory' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Seeds' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('Seed list');
  });

  it('renders Tag with semantic hue classes', () => {
    render(
      <>
        <Tag hue="violet" icon={<CheckIcon small />}>
          Epic
        </Tag>
        <Tag hue="yellow" solid>
          Legendary
        </Tag>
      </>,
    );

    const epic = screen.getByText('Epic').closest('.bb-tag');
    expect(epic?.className).toContain('bb-tag--violet');
    const legendary = screen.getByText('Legendary').closest('.bb-tag');
    expect(legendary?.className).toContain('bb-tag--yellow');
    expect(legendary?.className).toContain('bb-tag--solid');
  });

  it('renders TextField with persistent label, helper text, and error message', () => {
    render(
      <>
        <TextField label="Garden name" helperText="You can change this later." />
        <TextField label="Friend code" error="Friend codes have 9 characters." />
      </>,
    );

    const gardenInput = screen.getByLabelText('Garden name');
    expect(gardenInput.getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByText('You can change this later.')).toBeTruthy();

    const codeInput = screen.getByLabelText('Friend code');
    expect(codeInput.getAttribute('aria-invalid')).toBe('true');
    expect(codeInput.closest('.bb-field')?.className).toContain('bb-field--error');
    expect(screen.getByText('Friend codes have 9 characters.')).toBeTruthy();
  });
});

describe('ScrollFade', () => {
  it('wraps its children in a sideways scroller that starts with no fades in a roomy row', () => {
    const { container } = render(
      <ScrollFade>
        <ChipGroup label="More">
          <Chip>One</Chip>
          <Chip selected>Two</Chip>
        </ChipGroup>
      </ScrollFade>,
    );
    const row = container.querySelector('.bb-scrollfade')!;
    expect(row.getAttribute('data-fade-start')).toBe('false');
    expect(row.getAttribute('data-fade-end')).toBe('false');
    expect(row.querySelectorAll('.bb-chip')).toHaveLength(2);
  });

  it('fades the edge that still has content behind it', () => {
    const { container } = render(
      <ScrollFade>
        <span>wide</span>
      </ScrollFade>,
    );
    const row = container.querySelector<HTMLElement>('.bb-scrollfade')!;
    Object.defineProperty(row, 'clientWidth', { configurable: true, value: 100 });
    Object.defineProperty(row, 'scrollWidth', { configurable: true, value: 300 });
    fireEvent.scroll(row);
    expect(row.getAttribute('data-fade-end')).toBe('true');
    row.scrollLeft = 200;
    fireEvent.scroll(row);
    expect(row.getAttribute('data-fade-start')).toBe('true');
    expect(row.getAttribute('data-fade-end')).toBe('false');
  });
});
