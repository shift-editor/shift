export class WebGLRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2");
    if (!gl) throw new Error("WebGL2 not supported");
    this.gl = gl;

    this.gl.viewport(0, 0, canvas.width, canvas.height);

    // Create shaders
    const vertexShader = this.createShader(
      this.gl.VERTEX_SHADER,
      `
      attribute vec2 position;
      void main() {
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `
    );

    const fragmentShader = this.createShader(
      this.gl.FRAGMENT_SHADER,
      `
      precision mediump float;
      void main() {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); // Black color
      }
    `
    );

    // Create program
    const program = this.gl.createProgram();
    if (!program) throw new Error("Failed to create program");
    this.program = program;

    this.gl.attachShader(this.program, vertexShader);
    this.gl.attachShader(this.program, fragmentShader);
    this.gl.linkProgram(this.program);

    if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
      throw new Error(
        "Program failed to link: " + this.gl.getProgramInfoLog(this.program)
      );
    }

    // Use program
    this.gl.useProgram(this.program);

    // Set viewport
    this.gl.viewport(0, 0, canvas.width, canvas.height);
  }

  private createShader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) throw new Error("Failed to create shader");

    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      throw new Error(
        "Shader failed to compile: " + this.gl.getShaderInfoLog(shader)
      );
    }

    return shader;
  }

  renderTriangles(vertices: Float32Array | number[]) {
    // Clear canvas with white background
    this.gl.clearColor(1.0, 1.0, 1.0, 1.0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    const vertexArray = new Float32Array(vertices);
    console.log("Drawing triangles with vertices:", vertexArray);

    // Create and use the shaders
    const vertShader = this.createShader(
      this.gl.VERTEX_SHADER,
      this.vertexShader
    );
    const fragShader = this.createShader(
      this.gl.FRAGMENT_SHADER,
      fragmentShader
    );

    // Create and link program
    const program = this.gl.createProgram()!;
    this.gl.attachShader(program, vertShader);
    this.gl.attachShader(program, fragShader);
    this.gl.linkProgram(program);
    this.gl.useProgram(program);

    // Create and bind buffer
    const buffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, vertexArray, this.gl.STATIC_DRAW);

    // Set up attribute
    const positionLocation = this.gl.getAttribLocation(program, "position");
    this.gl.enableVertexAttribArray(positionLocation);
    this.gl.vertexAttribPointer(
      positionLocation,
      2, // size (2 components per vertex)
      this.gl.FLOAT, // type
      false, // normalize
      0, // stride
      0 // offset
    );

    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);

    // Draw triangles
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, vertexArray.length / 2);

    // Cleanup
    this.gl.deleteBuffer(buffer);
    this.gl.deleteProgram(program);
    this.gl.deleteShader(vertShader);
    this.gl.deleteShader(fragShader);
  }

  renderTestTriangle() {
    // Clear canvas with white background
    this.gl.clearColor(1.0, 1.0, 1.0, 1.0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    // Simple triangle vertices
    const vertices = new Float32Array([
      0.0,
      0.5, // top center
      -0.5,
      -0.5, // bottom left
      0.5,
      -0.5, // bottom right
    ]);

    const buffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);

    const positionLocation = this.gl.getAttribLocation(
      this.program,
      "position"
    );
    this.gl.enableVertexAttribArray(positionLocation);
    this.gl.vertexAttribPointer(
      positionLocation,
      2, // x,y components
      this.gl.FLOAT,
      false,
      0,
      0
    );

    // Draw a single triangle
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);

    // Clean up
    this.gl.deleteBuffer(buffer);
  }
}
