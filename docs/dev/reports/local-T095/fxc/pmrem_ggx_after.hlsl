// T095 probe: a hand translation, in ANGLE's HLSL style, of three.js r186 PMREMGenerator._getGGXShader()
// ("PMREMGGXConvolution") fragment shader. Purpose: reproduce FXC warning X4122 offline (no browser, no GPU).
// Variable names carry a 4-digit id like ANGLE's so that the two lines of interest have ANGLE's columns.
uniform float _roughness : register(c0);
uniform float _mipInt : register(c1);
uniform int _ggxFirst : register(c2);
Texture2D<float4> _envMap : register(t0);
SamplerState _envMapSampler : register(s0);

static float3 _vOutputDirection = {0, 0, 0};
static float4 out_fragColor = {0, 0, 0, 0};

float f_getFace(in float3 _direction)
{
float3 _absDirection5601 = abs(_direction);
float _face5602 = {-1.0};
if ((_absDirection5601.x > _absDirection5601.z))
{
if ((_absDirection5601.x > _absDirection5601.y))
{
(_face5602 = ((_direction.x > 0.0) ? 0.0 : 3.0));
}
else
{
(_face5602 = ((_direction.y > 0.0) ? 1.0 : 4.0));
}
}
else
{
if ((_absDirection5601.z > _absDirection5601.y))
{
(_face5602 = ((_direction.z > 0.0) ? 2.0 : 5.0));
}
else
{
(_face5602 = ((_direction.y > 0.0) ? 1.0 : 4.0));
}
}
return _face5602;
}
float2 f_getUV(in float3 _direction, in float _face)
{
float2 _uv5605 = {0, 0};
if ((_face == 0.0))
{
(_uv5605 = (float2(_direction.z, _direction.y) / abs(_direction.x)));
}
else
{
if ((_face == 1.0))
{
(_uv5605 = (float2((-_direction.x), (-_direction.z)) / abs(_direction.y)));
}
else
{
if ((_face == 2.0))
{
(_uv5605 = (float2((-_direction.x), _direction.y) / abs(_direction.z)));
}
else
{
if ((_face == 3.0))
{
(_uv5605 = (float2((-_direction.z), _direction.y) / abs(_direction.x)));
}
else
{
if ((_face == 4.0))
{
(_uv5605 = (float2((-_direction.x), _direction.z) / abs(_direction.y)));
}
else
{
(_uv5605 = (float2(_direction.x, _direction.y) / abs(_direction.z)));
}
}
}
}
}
return (0.5 * (_uv5605 + 1.0));
}
float3 f_bilinearCubeUV(in float3 _direction, in float _mipInt)
{
float _face5610 = f_getFace(_direction);
float _filterInt5611 = max((4.0 - _mipInt), 0.0);
(_mipInt = max(_mipInt, 4.0));
float _faceSize5612 = exp2(_mipInt);
float2 _uv5613 = ((f_getUV(_direction, _face5610) * (_faceSize5612 - 2.0)) + 1.0);
if ((_face5610 > 2.0))
{
(_uv5613.y += _faceSize5612);
(_face5610 -= 3.0);
}
(_uv5613.x += (_face5610 * _faceSize5612));
(_uv5613.x += ((_filterInt5611 * 3.0) * 16.0));
(_uv5613.y += (4.0 * (256.0 - _faceSize5612)));
(_uv5613.x *= 0.0013020834);
(_uv5613.y *= 0.00097656250);
return _envMap.SampleGrad(_envMapSampler, _uv5613, float2(0.0, 0.0), float2(0.0, 0.0)).xyz;
}
float f_radicalInverse_VdC(in uint _bits)
{
(_bits = ((_bits << 16) | (_bits >> 16)));
(_bits = (((_bits & 1431655765) << 1) | ((_bits & 2863311530) >> 1)));
(_bits = (((_bits & 858993459) << 2) | ((_bits & 3435973836) >> 2)));
(_bits = (((_bits & 252645135) << 4) | ((_bits & 4042322160) >> 4)));
(_bits = (((_bits & 16711935) << 8) | ((_bits & 4278255360) >> 8)));
return (float(_bits) * 2.3283064e-10);
}
float2 f_hammersley(in uint _i, in uint _N)
{
return float2((float(_i) / float(_N)), f_radicalInverse_VdC(_i));
}
float3 f_importanceSampleGGX_VNDF(in float2 _Xi, in float3 _V, in float _roughness)
{
float _alpha5631 = (_roughness * _roughness);
float3 _T15632 = float3(1.0, 0.0, 0.0);
float3 _T25633 = cross(_V, _T15632);
float _r5634 = sqrt(_Xi.x);
float _phi5635 = (6.2831855 * _Xi.y);
float _t15636 = (_r5634 * cos(_phi5635));
float _t25637 = (_r5634 * sin(_phi5635));
float _s5638 = (0.5 * (1.0 + _V.z));
(_t25637 = (((1.0 - _s5638) * sqrt((1.0 - (_t15636 * _t15636)))) + (_s5638 * _t25637)));
float3 _Nh5639 = (((_t15636 * _T15632) + (_t25637 * _T25633)) + (sqrt(max(0.0, ((1.0 - (_t15636 * _t15636)) - (_t25637 * _t25637)))) * _V));
return normalize(float3((_alpha5631 * _Nh5639.x), (_alpha5631 * _Nh5639.y), max(0.0, _Nh5639.z)));
}
void gl_main()
{
float3 _N5641 = normalize(_vOutputDirection);
float3 _V5642 = _N5641;
float3 _prefilteredColor5643 = float3(0.0, 0.0, 0.0);
float _totalWeight5644 = {0.0};
if ((_roughness < 0.001))
{
(out_fragColor = float4(f_bilinearCubeUV(_N5641, _mipInt), 1.0));
return;
}
float3 _up5645 = ((abs(_N5641.z) < 0.99900001) ? float3(0.0, 0.0, 1.0) : float3(1.0, 0.0, 0.0));
float3 _tangent5646 = normalize(cross(_up5645, _N5641));
float3 _bitangent5647 = cross(_N5641, _tangent5646);
{ for(uint _i5648 = uint(_ggxFirst); (_i5648 < 256); (_i5648++))
{
float2 _Xi5649 = f_hammersley(_i5648, 256);
float3 _H_tangent5650 = f_importanceSampleGGX_VNDF(_Xi5649, float3(0.0, 0.0, 1.0), _roughness);
float3 _H5651 = normalize((((_tangent5646 * _H_tangent5650.x) + (_bitangent5647 * _H_tangent5650.y)) + (_N5641 * _H_tangent5650.z)));
float3 _L5652 = normalize((((2.0 * dot(_V5642, _H5651)) * _H5651) - _V5642));
float _NdotL5653 = max(dot(_N5641, _L5652), 0.0);
if ((_NdotL5653 > 0.0))
{
float3 _sampleColor5654 = f_bilinearCubeUV(_L5652, _mipInt);
(_prefilteredColor5643 += (_sampleColor5654 * _NdotL5653));
(_totalWeight5644 += _NdotL5653);
}
}
}
if ((_totalWeight5644 > 0.0))
{
(_prefilteredColor5643 = (_prefilteredColor5643 / _totalWeight5644));
}
(out_fragColor = float4(_prefilteredColor5643, 1.0));
}
struct PS_INPUT { float4 dx_Position : SV_Position; float3 v0 : TEXCOORD0; };
struct PS_OUTPUT { float4 out_fragColor : SV_TARGET0; };
PS_OUTPUT main(PS_INPUT input)
{
_vOutputDirection = input.v0.xyz;
gl_main();
PS_OUTPUT output;
output.out_fragColor = out_fragColor;
return output;
}
