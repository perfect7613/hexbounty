declare module "gameboy-emulator" {
  export class Gameboy {
    fps: number;
    input: {
      isPressingUp: boolean;
      isPressingDown: boolean;
      isPressingLeft: boolean;
      isPressingRight: boolean;
      isPressingA: boolean;
      isPressingB: boolean;
      isPressingStart: boolean;
      isPressingSelect: boolean;
    };
    memory: {
      readByte(address: number): number;
    };
    run(): void;
    runFrame(time: number): void;
    onFrameFinished(callback: (imageData: ImageData) => void): void;
    loadGame(arrayBuffer: ArrayBuffer): void;
  }
}
