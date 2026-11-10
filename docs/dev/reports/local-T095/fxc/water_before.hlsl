// T095 probe: waterGround() of src/render/world/WaterRenderer.ts, hand-translated in ANGLE's HLSL style, to see
// FXC warning X4000 offline. Only the function and a caller that uses its value like waterShade() does.
uniform float _uN : register(c0);
uniform float _uCell : register(c1);
uniform float _uOuterExt : register(c2);
uniform float _uSea : register(c3);
uniform float3 _uShallow : register(c4);
uniform float3 _uDeep : register(c5);
static const uint _uHeightTex = 0;
static const uint _uOuterTex = 1;
uniform Texture2D<float4> textures2D[2] : register(t0);
uniform SamplerState samplers2D[2] : register(s0);
static float3 _vWW = {0, 0, 0};
static float4 out_fragColor = {0, 0, 0, 0};
float4 gl_texture2D(uint samplerIndex, float2 t)
{
    return textures2D[samplerIndex].Sample(samplers2D[samplerIndex], float2(t.x, t.y));
}
float f_waterGround_float3(in float3 _P)
{
float _W5691 = (_uN * _uCell);
if (((((_P.x >= 0.0) && (_P.z >= 0.0)) && (_P.x <= _W5691)) && (_P.z <= _W5691)))
{
float2 _uv5692 = (((_P.xz / _uCell) + 0.5) / (_uN + 1.0));
return gl_texture2D(_uHeightTex, _uv5692).x;
}
float2 _uv5693 = ((_P.xz + _uOuterExt) / (_W5691 + (2.0 * _uOuterExt)));
return gl_texture2D(_uOuterTex, _uv5693).x;
}
float3 f_waterShade_float3(in float3 _P)
{
float _ground5701 = f_waterGround_float3(_P);
float _depth5702 = max((_uSea - _ground5701), 0.0);
float _k5703 = (1.0 - exp(((-_depth5702) * 0.16)));
float3 _body5704 = lerp(_uShallow, _uDeep, _k5703);
(_body5704 *= (1.0 - (0.5 * smoothstep(12.0, 40.0, _depth5702))));
return _body5704;
}
void gl_main()
{
(out_fragColor = float4(f_waterShade_float3(_vWW), 1.0));
}
struct PS_INPUT { float4 dx_Position : SV_Position; float3 v0 : TEXCOORD0; };
struct PS_OUTPUT { float4 out_fragColor : SV_TARGET0; };
PS_OUTPUT main(PS_INPUT input)
{
_vWW = input.v0.xyz;
gl_main();
PS_OUTPUT output;
output.out_fragColor = out_fragColor;
return output;
}
