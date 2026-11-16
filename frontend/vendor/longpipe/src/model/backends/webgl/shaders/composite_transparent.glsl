#version 300 es
precision highp float;

uniform sampler2D u_image;
uniform sampler2D u_alpha;

out vec4 fragColor;

void main() {
    int height = textureSize(u_image, 0).y;
    ivec2 pixel = ivec2(int(gl_FragCoord.x), height - 1 - int(gl_FragCoord.y));
    vec3 foreground = texelFetch(u_image, pixel, 0).rgb;
    float alpha = clamp(texelFetch(u_alpha, pixel, 0).r, 0.0, 1.0);
    fragColor = vec4(foreground * alpha, alpha);
}
