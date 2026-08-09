import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import HomePage from '@/app/page';

describe('HomePage (Stage 2A foundation placeholder)', () => {
  it('renders the foundation heading', () => {
    render(<HomePage />);

    expect(
      screen.getByRole('heading', { name: /project foundation/i }),
    ).toBeInTheDocument();
  });

  it('makes clear the public UI is not yet implemented', () => {
    render(<HomePage />);

    expect(screen.getByText(/not implemented/i)).toBeInTheDocument();
  });
});
