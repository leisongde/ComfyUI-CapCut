struct VertexOut {
    @builtin(position) pos: vec4<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
    let vertices = array<vec2<f32>, 6>(
        vec2(-1.0, -1.0), vec2( 1.0, -1.0), vec2(-1.0,  1.0),
        vec2(-1.0,  1.0), vec2( 1.0, -1.0), vec2( 1.0,  1.0),
    );
    var output: VertexOut;
    output.pos = vec4<f32>(vertices[vertexIndex], 0.0, 1.0);
    return output;
}

struct Params {
    width: u32,
    _padding0: u32,
    _padding1: u32,
    _padding2: u32,
};

@group(0) @binding(0) var<storage, read> image: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> matte: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: Params;

@fragment
fn fs(input: VertexOut) -> @location(0) vec4<f32> {
    let index = u32(input.pos.y) * params.width + u32(input.pos.x);
    let alpha = clamp(matte[index].r, 0.0, 1.0);
    return vec4<f32>(image[index].rgb * alpha, alpha);
}
