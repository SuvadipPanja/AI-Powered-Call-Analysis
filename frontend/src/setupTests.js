// jest-dom adds custom jest matchers for asserting on DOM nodes.
import '@testing-library/jest-dom';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(() => ({
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
      get: jest.fn(),
      post: jest.fn(),
    })),
    get: jest.fn(),
    post: jest.fn(),
  },
}));
