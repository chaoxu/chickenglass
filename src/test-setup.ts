import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import { installLocalStorageMock } from "./test-utils";

const localStorageMock = installLocalStorageMock();

beforeEach(() => {
  localStorageMock.clear();
});
