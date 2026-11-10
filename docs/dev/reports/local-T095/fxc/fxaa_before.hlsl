// T095 probe: three.js r186 FXAAShader (examples/jsm/shaders/FXAAShader.js) fragment shader, hand-translated in
// the HLSL style of ANGLE, to see FXC warnings X3595 and X4000 offline. The texture helpers are the ones ANGLE emits.
uniform float2 _resolution : register(c0);
static const uint _tDiffuse = 0;
uniform Texture2D<float4> textures2D[1] : register(t0);
uniform SamplerState samplers2D[1] : register(s0);
static float2 _vUv = {0, 0};
static float4 out_fragColor = {0, 0, 0, 0};
float4 gl_texture2D(uint samplerIndex, float2 t)
{
    return textures2D[samplerIndex].Sample(samplers2D[samplerIndex], float2(t.x, t.y));
}
float4 gl_texture2DLod(uint samplerIndex, float2 t, float lod)
{
    return textures2D[samplerIndex].SampleLevel(samplers2D[samplerIndex], float2(t.x, t.y), lod);
}
struct _LuminanceData
{
    float _m;
    float _n;
    float _e;
    float _s;
    float _w;
    float _ne;
    float _nw;
    float _se;
    float _sw;
    float _highest;
    float _lowest;
    float _contrast;
};
struct _EdgeData
{
    bool _isHorizontal;
    float _pixelStep;
    float _oppositeLuminance;
    float _gradient;
};
static const float _edgeSteps[6] = {1.0, 1.5, 2.0, 2.0, 2.0, 4.0};
static float __ContrastThreshold = {0.031199999};
static float __RelativeThreshold = {0.063000001};
static float __SubpixelBlending = {1.0};
float4 f_Sample(const uint _tex2D, in float2 _uv)
{
return gl_texture2D(_tex2D, _uv);
}
float f_SampleLuminance(const uint _tex2D, in float2 _uv)
{
return dot(f_Sample(_tex2D, _uv).xyz, float3(0.30000001, 0.58999997, 0.11));
}
float f_SampleLuminance5(const uint _tex2D, in float2 _texSize, in float2 _uv, in float _uOffset, in float _vOffset)
{
(_uv += (_texSize * float2(_uOffset, _vOffset)));
return f_SampleLuminance(_tex2D, _uv);
}
_LuminanceData f_SampleLuminanceNeighborhood(const uint _tex2D, in float2 _texSize, in float2 _uv)
{
_LuminanceData _l5601 = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
(_l5601._m = f_SampleLuminance(_tex2D, _uv));
(_l5601._n = f_SampleLuminance5(_tex2D, _texSize, _uv, 0.0, 1.0));
(_l5601._e = f_SampleLuminance5(_tex2D, _texSize, _uv, 1.0, 0.0));
(_l5601._s = f_SampleLuminance5(_tex2D, _texSize, _uv, 0.0, -1.0));
(_l5601._w = f_SampleLuminance5(_tex2D, _texSize, _uv, -1.0, 0.0));
(_l5601._ne = f_SampleLuminance5(_tex2D, _texSize, _uv, 1.0, 1.0));
(_l5601._nw = f_SampleLuminance5(_tex2D, _texSize, _uv, -1.0, 1.0));
(_l5601._se = f_SampleLuminance5(_tex2D, _texSize, _uv, 1.0, -1.0));
(_l5601._sw = f_SampleLuminance5(_tex2D, _texSize, _uv, -1.0, -1.0));
(_l5601._highest = max(max(max(max(_l5601._n, _l5601._e), _l5601._s), _l5601._w), _l5601._m));
(_l5601._lowest = min(min(min(min(_l5601._n, _l5601._e), _l5601._s), _l5601._w), _l5601._m));
(_l5601._contrast = (_l5601._highest - _l5601._lowest));
return _l5601;
}
bool f_ShouldSkipPixel(in _LuminanceData _l)
{
float _threshold5602 = max(__ContrastThreshold, (__RelativeThreshold * _l._highest));
return (_l._contrast < _threshold5602);
}
float f_DeterminePixelBlendFactor(in _LuminanceData _l)
{
float _f5603 = (2.0 * (((_l._n + _l._e) + _l._s) + _l._w));
(_f5603 += (((_l._ne + _l._nw) + _l._se) + _l._sw));
(_f5603 *= 0.083333336);
(_f5603 = abs((_f5603 - _l._m)));
(_f5603 = clamp((_f5603 / _l._contrast), 0.0, 1.0));
float _blendFactor5604 = smoothstep(0.0, 1.0, _f5603);
return ((_blendFactor5604 * _blendFactor5604) * __SubpixelBlending);
}
_EdgeData f_DetermineEdge(in float2 _texSize, in _LuminanceData _l)
{
_EdgeData _e5605 = {0, 0, 0, 0};
float _horizontal5606 = (((abs(((_l._n + _l._s) - (2.0 * _l._m))) * 2.0) + abs(((_l._ne + _l._se) - (2.0 * _l._e)))) + abs(((_l._nw + _l._sw) - (2.0 * _l._w))));
float _vertical5607 = (((abs(((_l._e + _l._w) - (2.0 * _l._m))) * 2.0) + abs(((_l._ne + _l._nw) - (2.0 * _l._n)))) + abs(((_l._se + _l._sw) - (2.0 * _l._s))));
(_e5605._isHorizontal = (_horizontal5606 >= _vertical5607));
float _pLuminance5608 = (_e5605._isHorizontal ? _l._n : _l._e);
float _nLuminance5609 = (_e5605._isHorizontal ? _l._s : _l._w);
float _pGradient5610 = abs((_pLuminance5608 - _l._m));
float _nGradient5611 = abs((_nLuminance5609 - _l._m));
(_e5605._pixelStep = (_e5605._isHorizontal ? _texSize.y : _texSize.x));
if ((_pGradient5610 < _nGradient5611))
{
(_e5605._pixelStep = (-_e5605._pixelStep));
(_e5605._oppositeLuminance = _nLuminance5609);
(_e5605._gradient = _nGradient5611);
}
else
{
(_e5605._oppositeLuminance = _pLuminance5608);
(_e5605._gradient = _pGradient5610);
}
return _e5605;
}
float f_DetermineEdgeBlendFactor(const uint _tex2D, in float2 _texSize, in _LuminanceData _l, in _EdgeData _e, in float2 _uv)
{
float2 _uvEdge5612 = _uv;
float2 _edgeStep5613 = {0, 0};
if (_e._isHorizontal)
{
(_uvEdge5612.y += (_e._pixelStep * 0.5));
(_edgeStep5613 = float2(_texSize.x, 0.0));
}
else
{
(_uvEdge5612.x += (_e._pixelStep * 0.5));
(_edgeStep5613 = float2(0.0, _texSize.y));
}
float _edgeLuminance5614 = ((_l._m + _e._oppositeLuminance) * 0.5);
float _gradientThreshold5615 = (_e._gradient * 0.25);
float2 _puv5616 = (_uvEdge5612 + (_edgeStep5613 * _edgeSteps[0]));
float _pLuminanceDelta5617 = (f_SampleLuminance(_tex2D, _puv5616) - _edgeLuminance5614);
bool _pAtEnd5618 = (abs(_pLuminanceDelta5617) >= _gradientThreshold5615);
{ [loop] for(int _i5619 = {1}; ((_i5619 < 6) && (!_pAtEnd5618)); (_i5619++))
{
(_puv5616 += (_edgeStep5613 * _edgeSteps[_i5619]));
(_pLuminanceDelta5617 = (f_SampleLuminance(_tex2D, _puv5616) - _edgeLuminance5614));
(_pAtEnd5618 = (abs(_pLuminanceDelta5617) >= _gradientThreshold5615));
}
}
if ((!_pAtEnd5618))
{
(_puv5616 += (_edgeStep5613 * 8.0));
}
float2 _nuv5620 = (_uvEdge5612 - (_edgeStep5613 * _edgeSteps[0]));
float _nLuminanceDelta5621 = (f_SampleLuminance(_tex2D, _nuv5620) - _edgeLuminance5614);
bool _nAtEnd5622 = (abs(_nLuminanceDelta5621) >= _gradientThreshold5615);
{ [loop] for(int _i5623 = {1}; ((_i5623 < 6) && (!_nAtEnd5622)); (_i5623++))
{
(_nuv5620 -= (_edgeStep5613 * _edgeSteps[_i5623]));
(_nLuminanceDelta5621 = (f_SampleLuminance(_tex2D, _nuv5620) - _edgeLuminance5614));
(_nAtEnd5622 = (abs(_nLuminanceDelta5621) >= _gradientThreshold5615));
}
}
if ((!_nAtEnd5622))
{
(_nuv5620 -= (_edgeStep5613 * 8.0));
}
float _pDistance5624 = {0}, _nDistance5625 = {0};
if (_e._isHorizontal)
{
(_pDistance5624 = (_puv5616.x - _uv.x));
(_nDistance5625 = (_uv.x - _nuv5620.x));
}
else
{
(_pDistance5624 = (_puv5616.y - _uv.y));
(_nDistance5625 = (_uv.y - _nuv5620.y));
}
float _shortestDistance5626 = {0};
bool _deltaSign5627 = {0};
if ((_pDistance5624 <= _nDistance5625))
{
(_shortestDistance5626 = _pDistance5624);
(_deltaSign5627 = (_pLuminanceDelta5617 >= 0.0));
}
else
{
(_shortestDistance5626 = _nDistance5625);
(_deltaSign5627 = (_nLuminanceDelta5621 >= 0.0));
}
if ((_deltaSign5627 == ((_l._m - _edgeLuminance5614) >= 0.0)))
{
return 0.0;
}
return (0.5 - (_shortestDistance5626 / (_pDistance5624 + _nDistance5625)));
}
float4 f_ApplyFXAA(const uint _tex2D, in float2 _texSize, in float2 _uv)
{
_LuminanceData _luminance5628 = f_SampleLuminanceNeighborhood(_tex2D, _texSize, _uv);
if (f_ShouldSkipPixel(_luminance5628))
{
return f_Sample(_tex2D, _uv);
}
float _pixelBlend5629 = f_DeterminePixelBlendFactor(_luminance5628);
_EdgeData _edge5630 = f_DetermineEdge(_texSize, _luminance5628);
float _edgeBlend5631 = f_DetermineEdgeBlendFactor(_tex2D, _texSize, _luminance5628, _edge5630, _uv);
float _finalBlend5632 = max(_pixelBlend5629, _edgeBlend5631);
if (_edge5630._isHorizontal)
{
(_uv.y += (_edge5630._pixelStep * _finalBlend5632));
}
else
{
(_uv.x += (_edge5630._pixelStep * _finalBlend5632));
}
return f_Sample(_tex2D, _uv);
}
void gl_main()
{
(out_fragColor = f_ApplyFXAA(_tDiffuse, _resolution.xy, _vUv));
}
struct PS_INPUT { float4 dx_Position : SV_Position; float2 v0 : TEXCOORD0; };
struct PS_OUTPUT { float4 out_fragColor : SV_TARGET0; };
PS_OUTPUT main(PS_INPUT input)
{
_vUv = input.v0.xy;
gl_main();
PS_OUTPUT output;
output.out_fragColor = out_fragColor;
return output;
}
